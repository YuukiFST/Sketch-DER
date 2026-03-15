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

Se preferir rodar localmente no seu computador, você precisará de um servidor local simples (por causa dos módulos ES6):

- **Se usa VS Code:** Instale a extensão "Live Server" e clique em "Go Live".
- **Se tem Python:** Rode `python -m http.server` na pasta.
- **Se tem Node:** Rode `npx serve` na pasta.

Depois é só abrir o endereço que aparecer (geralmente `http://localhost:8000` ou `5500`).
