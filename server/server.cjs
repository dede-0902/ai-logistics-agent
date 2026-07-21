const express = require('express')
const app = express()
app.use(express.json())

// Coze 代理
app.post('/api/coze', async (req, res) => {
  const token = process.env.COZE_TOKEN || 'pat_3dzfQcYItGeXEiwEoIvitsBp7rqKSx60VOPiNAwAoxgP8FKIbY0obovp3Ysvxjl4'
  try {
    const r = await fetch('https://api.coze.cn/v1/workflows/chat', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow_id: '7663285609365225499',
        additional_messages: [{ role: 'user', content_type: 'text', content: req.body.input }],
        parameters: { CONVERSATION_NAME: req.body.conversationName || 'dev' },
      }),
    })
    const text = await r.text()
    res.setHeader('Content-Type', 'text/event-stream')
    res.send(text)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 日志 API
const logs = []; let id = 0
app.post('/api/log', (req, res) => {
  logs.unshift({ id: ++id, ...req.body })
  res.json({ ok: true })
})
app.get('/api/logs', (req, res) => res.json({ logs: logs.slice(0, 100), total: logs.length }))
app.get('/api/stats', (req, res) => res.json({ total: logs.length }))

app.listen(3001, () => console.log('Local server on :3001'))
