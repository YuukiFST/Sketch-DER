# Sketch-DER

Fiz esse projeto pra me ajudar na faculdade. Se você já usou o BRModelo (especialmente a versão 2.0), sabe que ele é horrível. É lento, trava o tempo todo e ficar corrigindo o DER Conceitual lá é um saco de tão bugado que o programa é.

O **Sketch-DER** resolve isso sendo o "passo zero". Em vez de ficar lutando contra a interface do BRModelo, você usa inteligência artificial pra rascunhar tudo em segundos.

## Como funciona o workflow

1. **Pega a "receita":** No próprio site, na aba "Sintaxe", tem as instruções de como escrever o script de desenho.
2. **Usa uma IA:** Copia essa sintaxe, cola na sua LLM favorita (ChatGPT, Claude, Gemini, tanto faz qual você usa) e pede pra ela: _"Gere um script de DER Conceitual seguindo esse modelo para o meu projeto de [Seu Projeto Aqui com as especificações do banco de dados]"_.
3. **Visualiza:** Cola o resultado no Sketch-DER. Em pouquíssimos minutos você tem o diagrama completo e bonitão na tela.

Depois que a lógica estiver batida e você tiver certeza do que precisa, aí sim você leva pro BRModelo só pra entregar o trabalho — mas sem ter que passar horas brigando com ele pra ajustar cada bolinha de atributo.

## O que ele faz

- **Nada de cliques infinitos:** Cria entidades, relacionamentos e atributos via texto.
- **Controle Total:** O site tenta organizar pra você, mas você manda no layout. Pode arrastar tudo.
- **Lasso de Seleção:** Seleciona grupos de itens (como todos os atributos de uma entidade) e move de uma vez.
- **Atalhos Rápidos:** Use `O` pra organizar os atributos em fila e `R` pra inverter o lado da lista (ou só dos itens que você selecionou no lasso).
- **Sem Medo:** Tem Ctrl+Z e Ctrl+Y pra você testar posições sem quebrar o diagrama.

## Como rodar

A forma mais fácil de usar é através do link oficial, assim você não precisa baixar nada:

- **Acesse agora:** [https://yuukifst.github.io/Sketch-DER/](https://yuukifst.github.io/Sketch-DER/)

## 🤝 Trabalho em Equipe (Colaboração)

Agora o Sketch-DER suporta colaboração em tempo real de alta performance. Você pode desenhar com seus colegas simultaneamente, com movimentos suaves a 60fps.

### Como usar:

1. Clique no botão **🤝 Colaborar** no menu superior.
2. Digite seu nome e clique em **Criar Sala**.
3. Copie o **código de 6 caracteres** (ex: `DER-4F2A`) e envie para seus amigos.
4. Seus amigos devem abrir o link, digitar o nome deles, colar o código e clicar em **Entrar na Sala**.

### O que acontece:

- **Cursores Remotos:** Veja exatamente onde seus colegas estão com o mouse.
- **Sistema de Locks:** Quando alguém começa a arrastar uma entidade ou relacionamento, ela fica travada (com a cor do usuário) para evitar que duas pessoas movam o mesmo item ao mesmo tempo.
- **Sincronização Total:** Mudanças no script, nomes de atributos ou posições são refletidas instantaneamente para todos na sala.
