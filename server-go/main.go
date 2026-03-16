package main

import (
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ─── Tipos de mensagem ───────────────────────────────────────────────────────

type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type UserInfo struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type MovePayload struct {
	ID string  `json:"id"` // ID do elemento
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
}

type LockPayload struct {
	ID     string `json:"id"`
	UserID string `json:"userId"`
}

type CursorPayload struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type CreateRoomPayload struct {
	UserName string `json:"userName"`
	State    string `json:"state"` // estado serializado do DER (JSON string)
}

type JoinRoomPayload struct {
	RoomCode string `json:"roomCode"`
	UserName string `json:"userName"`
}

// ─── Estruturas da sala ───────────────────────────────────────────────────────

type Client struct {
	conn *websocket.Conn
	send chan []byte
	room *Room
	info UserInfo
}

type Room struct {
	mu        sync.RWMutex
	code      string
	clients   map[string]*Client // key: UserInfo.ID
	state     string             // estado atual do DER
	locks     map[string]string  // elementId → userId que está segurando
	broadcast chan broadcastMsg
	quit      chan struct{}
}

type broadcastMsg struct {
	data      []byte
	excludeID string // não envia para este userID (evita eco)
}

// ─── Pool de salas ────────────────────────────────────────────────────────────

var (
	rooms   = make(map[string]*Room)
	roomsMu sync.RWMutex
)

var userColors = []string{"#E74C3C", "#2ECC71", "#3498DB", "#F39C12"}

func generateCode() string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 4)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return "DER-" + string(b)
}

func uniqueCode() string {
	roomsMu.RLock()
	defer roomsMu.RUnlock()
	for {
		c := generateCode()
		if _, exists := rooms[c]; !exists {
			return c
		}
	}
}

// ─── Goroutine de broadcast da sala ──────────────────────────────────────────

func (r *Room) run() {
	for {
		select {
		case msg := <-r.broadcast:
			r.mu.RLock()
			for id, c := range r.clients {
				if id == msg.excludeID {
					continue
				}
				select {
				case c.send <- msg.data:
				default:
					// canal cheio: cliente lento, descarta
				}
			}
			r.mu.RUnlock()
		case <-r.quit:
			return
		}
	}
}

// ─── Goroutine de escrita por cliente ────────────────────────────────────────

func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ─── Envio de mensagem estruturada ───────────────────────────────────────────

func encode(msgType string, payload any) []byte {
	p, _ := json.Marshal(payload)
	m, _ := json.Marshal(Message{Type: msgType, Payload: p})
	return m
}

func (c *Client) send_(msgType string, payload any) {
	c.send <- encode(msgType, payload)
}

// ─── Loop de leitura por cliente ─────────────────────────────────────────────

func (c *Client) readPump() {
	defer func() {
		removeClient(c)
	}()

	c.conn.SetReadLimit(64 * 1024)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			return
		}

		var msg Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}

		switch msg.Type {

		// Cliente arrasta elemento — retransmite para os outros imediatamente
		case "move":
			var p MovePayload
			if err := json.Unmarshal(msg.Payload, &p); err != nil {
				continue
			}
			// Só retransmite se o cliente tem o lock ou não há lock
			c.room.mu.RLock()
			owner, locked := c.room.locks[p.ID]
			c.room.mu.RUnlock()
			if !locked || owner == c.info.ID {
				out := encode("move", map[string]any{
					"id": p.ID, "x": p.X, "y": p.Y,
					"userId": c.info.ID,
				})
				c.room.broadcast <- broadcastMsg{data: out, excludeID: c.info.ID}
			}

		// Cliente pediu lock de elemento (começou a arrastar)
		case "lock":
			var p LockPayload
			if err := json.Unmarshal(msg.Payload, &p); err != nil {
				continue
			}
			c.room.mu.Lock()
			_, alreadyLocked := c.room.locks[p.ID]
			if !alreadyLocked {
				c.room.locks[p.ID] = c.info.ID
			}
			c.room.mu.Unlock()
			if !alreadyLocked {
				out := encode("lock", map[string]any{
					"id": p.ID, "userId": c.info.ID,
					"userName": c.info.Name, "color": c.info.Color,
				})
				c.room.broadcast <- broadcastMsg{data: out, excludeID: c.info.ID}
			}

		// Cliente soltou o elemento (liberou lock)
		case "unlock":
			var p LockPayload
			if err := json.Unmarshal(msg.Payload, &p); err != nil {
				continue
			}
			c.room.mu.Lock()
			if c.room.locks[p.ID] == c.info.ID {
				delete(c.room.locks, p.ID)
			}
			c.room.mu.Unlock()
			out := encode("unlock", map[string]any{"id": p.ID})
			c.room.broadcast <- broadcastMsg{data: out, excludeID: c.info.ID}

		// Movimento de cursor — alta frequência, só retransmite
		case "cursor":
			var p CursorPayload
			if err := json.Unmarshal(msg.Payload, &p); err != nil {
				continue
			}
			out := encode("cursor", map[string]any{
				"userId": c.info.ID, "x": p.X, "y": p.Y,
			})
			c.room.broadcast <- broadcastMsg{data: out, excludeID: c.info.ID}

		// Cliente gerou novo DER (mudou o script) — salva estado e distribui
		case "der_update":
			var state string
			if err := json.Unmarshal(msg.Payload, &state); err != nil {
				continue
			}
			c.room.mu.Lock()
			c.room.state = state
			c.room.mu.Unlock()
			out := encode("der_update", map[string]any{
				"userId": c.info.ID,
				"state":  state,
			})
			c.room.broadcast <- broadcastMsg{data: out, excludeID: c.info.ID}

		// Sync periódico de posições (enviado pelo cliente a cada 10s)
		case "state_sync":
			var state string
			if err := json.Unmarshal(msg.Payload, &state); err != nil {
				continue
			}
			c.room.mu.Lock()
			c.room.state = state
			c.room.mu.Unlock()
			// Não retransmite — só salva no servidor
		}
	}
}

// ─── Remoção de cliente ao desconectar ───────────────────────────────────────

func removeClient(c *Client) {
	c.room.mu.Lock()
	delete(c.room.clients, c.info.ID)

	// Libera todos os locks que este cliente tinha
	for elemID, ownerID := range c.room.locks {
		if ownerID == c.info.ID {
			delete(c.room.locks, elemID)
			// Avisa os outros que o lock foi liberado
			out := encode("unlock", map[string]any{"id": elemID})
			c.room.broadcast <- broadcastMsg{data: out}
		}
	}

	remaining := len(c.room.clients)
	code := c.room.code
	c.room.mu.Unlock()

	close(c.send)

	if remaining == 0 {
		// Sala vazia: destrói
		roomsMu.Lock()
		delete(rooms, code)
		roomsMu.Unlock()
		c.room.quit <- struct{}{}
		return
	}

	// Monta lista de usuários restantes
	c.room.mu.RLock()
	users := make([]UserInfo, 0, len(c.room.clients))
	for _, cl := range c.room.clients {
		users = append(users, cl.info)
	}
	c.room.mu.RUnlock()

	out := encode("user_left", map[string]any{
		"userId": c.info.ID,
		"users":  users,
	})
	c.room.broadcast <- broadcastMsg{data: out}
}

// ─── HTTP handler do WebSocket ───────────────────────────────────────────────

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// Permissivo para evitar bloqueios de Origin em diferentes ambientes/GHPages
		return true
	},
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade:", err)
		return
	}

	// Primeira mensagem deve ser create_room ou join_room
	conn.SetReadDeadline(time.Now().Add(15 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		conn.Close()
		return
	}
	conn.SetReadDeadline(time.Time{}) // reseta deadline

	var msg Message
	if err := json.Unmarshal(raw, &msg); err != nil {
		conn.Close()
		return
	}

	var room *Room
	var userInfo UserInfo

	switch msg.Type {

	case "create_room":
		var p CreateRoomPayload
		if err := json.Unmarshal(msg.Payload, &p); err != nil {
			conn.Close()
			return
		}
		code := uniqueCode()
		userInfo = UserInfo{
			ID:    randomID(),
			Name:  p.UserName,
			Color: userColors[0],
		}
		room = &Room{
			code:      code,
			clients:   make(map[string]*Client),
			state:     p.State,
			locks:     make(map[string]string),
			broadcast: make(chan broadcastMsg, 256),
			quit:      make(chan struct{}, 1),
		}
		roomsMu.Lock()
		rooms[code] = room
		roomsMu.Unlock()
		go room.run()

	case "join_room":
		var p JoinRoomPayload
		if err := json.Unmarshal(msg.Payload, &p); err != nil {
			conn.Close()
			return
		}
		roomsMu.RLock()
		room = rooms[p.RoomCode]
		roomsMu.RUnlock()
		if room == nil {
			data := encode("join_error", map[string]string{"message": "Sala não encontrada."})
			conn.WriteMessage(websocket.TextMessage, data)
			conn.Close()
			return
		}
		room.mu.RLock()
		count := len(room.clients)
		room.mu.RUnlock()
		if count >= 4 {
			data := encode("join_error", map[string]string{"message": "Sala cheia (máximo 4)."})
			conn.WriteMessage(websocket.TextMessage, data)
			conn.Close()
			return
		}
		// Escolhe cor não usada
		usedColors := make(map[string]bool)
		room.mu.RLock()
		for _, cl := range room.clients {
			usedColors[cl.info.Color] = true
		}
		room.mu.RUnlock()
		color := userColors[0]
		for _, c := range userColors {
			if !usedColors[c] {
				color = c
				break
			}
		}
		userInfo = UserInfo{ID: randomID(), Name: p.UserName, Color: color}

	default:
		conn.Close()
		return
	}

	client := &Client{
		conn: conn,
		send: make(chan []byte, 256),
		room: room,
		info: userInfo,
	}

	room.mu.Lock()
	room.clients[userInfo.ID] = client
	users := make([]UserInfo, 0, len(room.clients))
	for _, cl := range room.clients {
		users = append(users, cl.info)
	}
	room.mu.Unlock()

	// Envia confirmação para quem acabou de entrar/criar
	var confirmType string
	if msg.Type == "create_room" {
		confirmType = "room_created"
	} else {
		confirmType = "room_joined"
	}
	confirm := encode(confirmType, map[string]any{
		"roomCode": room.code,
		"userInfo": userInfo,
		"users":    users,
		"state":    room.state,
		"locks":    room.locks,
	})
	conn.WriteMessage(websocket.TextMessage, confirm)

	// Avisa os outros que alguém entrou
	if msg.Type == "join_room" {
		out := encode("user_joined", map[string]any{
			"userInfo": userInfo,
			"users":    users,
		})
		room.broadcast <- broadcastMsg{data: out, excludeID: userInfo.ID}
	}

	go client.writePump()
	client.readPump() // bloqueia até desconexão
}

func randomID() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 8)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

func main() {
	rand.Seed(time.Now().UnixNano())
	http.HandleFunc("/ws", wsHandler)
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Sketch-DER collab server (Go) running."))
	})

	port := ":" + os.Getenv("PORT")
	if port == ":" {
		port = ":8080"
	}

	log.Println("Listening on", port)
	log.Fatal(http.ListenAndServe(port, nil))
}
