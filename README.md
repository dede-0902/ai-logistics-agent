# AI单号通 · 物流查询智能体

AI 物流查询小助手，输入快递单号自动查询物流进度并生成客服话术。

## 技术栈

- 前端：React + Vite
- 后端：Express (Vercel Serverless Function)
- 物流数据：Coze 工作流

## 本地开发

```bash
# 启动后端（日志 + Coze 代理）
cd server && node server.js

# 启动前端
npx vite --port 5173
```

## 部署

前端 → 阿里云 OSS 静态网站托管
后端 → Vercel Serverless Functions
