# RSP Workers

Cloudflare Workers 后端 — 提供身份验证、图片处理订阅、上传预签名等 API。

## 开发

```bash
npm install
npx wrangler dev   # 本地运行
```

## 部署

```bash
npx wrangler deploy
```

## 环境变量（Secrets）

部署前需要通过 `wrangler secret put` 设置以下变量：

```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
REPLICATE_API_TOKEN
RESEND_API_KEY
JWT_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
CREEM_API_KEY
CREEM_WEBHOOK_SECRET
```

本地开发请复制 `.dev.vars.example` 为 `.dev.vars` 并填入真实值。