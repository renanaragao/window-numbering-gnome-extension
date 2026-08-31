# Window Numbering (Letter Keybindings) — GNOME Shell Extension

Uma extensão leve para GNOME Shell que atribui letras às miniaturas das janelas
na **Visão Geral (Overview)**, permitindo focar qualquer aplicativo
instantaneamente usando combinações de teclado com `Shift`.

## 🛠️ Como Funciona

1. **Visão Geral (Overview):** Ao abrir a Visão Geral (pressionando a tecla
   `Super` / `Windows`), etiquetas visuais em tom azul aparecem no canto
   superior esquerdo de cada miniatura de janela.
2. **Atalho via Shift:** Pressione **`Shift + [LETRA]`** para focar a janela
   associada.
3. **Respeito à Pesquisa:** Se você começar a digitar para pesquisar na Visão
   Geral, as etiquetas somem automaticamente para não atrapalhar e os atalhos de
   navegação são desativados temporariamente.
4. **Reserva Fixa (JSON):** Janelas configuradas no arquivo de regras sempre
   recebem a mesma letra reservada. As janelas restantes recebem as letras
   livres do alfabeto sequencialmente.

---

## ⚙️ Configuração das Regras (`config.json`)

Você pode associar letras fixas aos seus aplicativos favoritos criando ou
editando o arquivo `config.json` no diretório da extensão.

### Estrutura do Arquivo

```json
{
  "reserved_rules": [
    {
      "match": "whatsapp",
      "key": "W"
    },
    {
      "match": "spotify",
      "key": "S"
    },
    {
      "match": "code",
      "key": "V"
    },
    {
      "match": "brave",
      "key": "B"
    }
  ]
}
```
