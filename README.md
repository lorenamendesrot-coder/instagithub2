# Insta Manager

Gerenciador de múltiplas contas do Instagram via Meta Graph API.  
Publica em várias contas de uma só vez, com delay configurável e histórico local.

## Stack

- **Frontend:** React + Vite (deploy no Netlify)
- **Backend:** Netlify Functions (serverless, Node.js)
- **Auth:** OAuth 2.0 com Meta/Facebook
- **Storage:** localStorage (contas e histórico ficam no navegador)

---

## Pré-requisitos

- Conta no [Netlify](https://netlify.com) (gratuito)
- App criado no [Meta for Developers](https://developers.facebook.com)
- Contas Instagram do tipo **Business** ou **Creator**
- Node.js 18+

---

## Passo 1 — Configurar o App na Meta

1. Acesse [developers.facebook.com](https://developers.facebook.com)
2. **Meus Apps → seu app → Configurações → Básico**  
   Anote o **ID do App** e o **Segredo do App**
3. Menu lateral → **Instagram → Configurações da API**  
   Adicione as permissões:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_read_engagement`
   - `pages_show_list`
   - `business_management`
4. **Produtos → Facebook Login → Configurações**  
   URI de redirecionamento: `https://SEU-SITE.netlify.app/api/auth-callback`

---

## Passo 2 — Deploy no Netlify

### Opção A — via GitHub (recomendado)

1. Suba o projeto para um repositório no GitHub
2. Netlify → **Add new site → Import an existing project → GitHub**
3. Selecione o repositório (o `netlify.toml` já configura tudo)

### Opção B — via CLI

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```

---

## Passo 3 — Variáveis de ambiente no Netlify

**Site settings → Environment variables → Add variable**

| Variável | Descrição |
|---|---|
| `META_APP_ID` | ID do App (Meta) |
| `META_APP_SECRET` | Segredo do App — **nunca exponha** |
| `META_REDIRECT_URI` | `https://SEU-SITE.netlify.app/api/auth-callback` |
| `VITE_META_APP_ID` | Mesmo que META_APP_ID (exposto ao frontend) |

Após adicionar: **Deploys → Trigger deploy**

---

## Rodar localmente

```bash
npm install
cp .env.example .env
# Preencha o .env com seus valores

npm install -g netlify-cli
netlify dev
```

Acesse: `http://localhost:8888`

---

## Como usar

### Conectar contas
1. Clique em **"+ Conectar conta"** na barra lateral
2. Autorize no Facebook
3. As contas Instagram vinculadas às páginas são salvas automaticamente

### Publicar posts
1. Vá em **"Novo post"**
2. Escolha o tipo: **Feed, Reel ou Story**
3. Cole a URL pública da mídia (Catbox, Cloudinary, S3, etc.)
4. Escreva a legenda (pode personalizar por conta)
5. Configure o delay entre postagens se quiser
6. Clique em **"Publicar"**

---

## Estrutura do projeto

```
insta-manager/
├── netlify/
│   └── functions/
│       ├── auth-callback.js   ← OAuth com a Meta
│       └── publish.js         ← Publicação em múltiplas contas
├── src/
│   ├── pages/
│   │   ├── Accounts.jsx       ← Tela de contas conectadas
│   │   ├── NewPost.jsx        ← Criar e publicar post
│   │   └── History.jsx        ← Histórico de publicações
│   ├── App.jsx                ← Layout, rotas, state global
│   ├── main.jsx
│   └── index.css
├── index.html
├── vite.config.js
├── netlify.toml
└── package.json
```

---

## Observações

- **URL da mídia:** A Meta API exige URLs públicas. Use [Catbox](https://catbox.moe), [Cloudinary](https://cloudinary.com), S3, etc.
- **Tipos de conta:** Apenas contas **Business** ou **Creator** têm acesso à API de publicação.
- **Reels/vídeos:** O processamento pode demorar até 2 minutos. O sistema aguarda automaticamente.
- **Tokens:** Tokens de página do Facebook têm duração longa. Se uma conta parar de funcionar, reconecte pelo botão na sidebar.
