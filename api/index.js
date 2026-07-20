/**
 * Vercel Serverless Function — AI单号通 后端 API
 * 处理日志接收 / 查询 / 看板 / Coze 代理
 */
import express from 'express'

const app = express()
app.use(express.json())

// 日志存储（内存，Vercel 冷启动会清空，Demo 够用）
let logs = []
let logId = 0

// CORS — 允许前端从 OSS 跨域调用
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  next()
})

/* ======================================================
   日志 API
   ====================================================== */

/** POST /api/log — 接收日志 */
app.post('/api/log', (req, res) => {
  const entry = {
    id: ++logId,
    timestamp: req.body.timestamp || new Date().toISOString(),
    sessionId: req.body.sessionId || '',
    conversationId: req.body.conversationId || '',
    userInput: (req.body.userInput || '').slice(0, 500),
    aiResponse: (req.body.aiResponse || '').slice(0, 2000),
    latencyMs: req.body.latencyMs ?? 0,
    tokens: req.body.tokens ?? 0,
    hasData: req.body.hasData ?? false,
    isError: req.body.isError ?? false,
    errorMessage: req.body.errorMessage || '',
    userAgent: req.body.userAgent || '',
    referrer: req.body.referrer || '',
  }
  logs.unshift(entry)  // 最新的在前面
  // 最多保留 2000 条
  if (logs.length > 2000) logs = logs.slice(0, 2000)
  res.json({ ok: true, id: entry.id })
})

/** GET /api/logs — 查日志列表 */
app.get('/api/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500)
  const offset = parseInt(req.query.offset) || 0
  res.json({ logs: logs.slice(offset, offset + limit), total: logs.length })
})

/** GET /api/stats — 聚合统计 */
app.get('/api/stats', (req, res) => {
  const total = logs.length
  const errors = logs.filter(l => l.isError).length
  const withData = logs.filter(l => l.hasData).length
  const latencies = logs.map(l => l.latencyMs).filter(l => l > 0)
  const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0
  const maxLatency = latencies.length ? Math.max(...latencies) : 0
  const totalTokens = logs.reduce((s, l) => s + (l.tokens || 0), 0)
  const todayCount = logs.filter(l => (l.timestamp || '').startsWith(new Date().toISOString().slice(0, 10))).length

  // 高频词统计
  const wordCount = {}
  logs.forEach(l => {
    if (l.userInput) {
      const text = l.userInput.replace(/[^一-龥a-zA-Z0-9]/g, ' ')
      text.split(/\s+/).filter(Boolean).forEach(w => {
        if (w.length >= 2) wordCount[w] = (wordCount[w] || 0) + 1
      })
    }
  })
  const topQueries = Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }))

  res.json({
    total, errors,
    errorRate: total ? Math.round(errors / total * 100) : 0,
    withData, dataRate: total ? Math.round(withData / total * 100) : 0,
    avgLatency, maxLatency, totalTokens, todayCount, topQueries,
  })
})

/** POST /api/coze — Coze 代理（保护 token） */
app.post('/api/coze', async (req, res) => {
  const token = process.env.COZE_TOKEN
  if (!token) {
    return res.status(500).json({ error: 'COZE_TOKEN 未设置，请在 Vercel 环境变量中配置' })
  }

  const { input, conversationName } = req.body || {}

  try {
    const cozeRes = await fetch('https://api.coze.cn/v1/workflows/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow_id: '7663285609365225499',
        additional_messages: [{ role: 'user', content_type: 'text', content: input }],
        parameters: { CONVERSATION_NAME: conversationName },
      }),
    })

    const fullText = await cozeRes.text()
    res.setHeader('Content-Type', 'text/event-stream')
    res.send(fullText)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* ======================================================
   Admin 看板
   ====================================================== */
app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI单号通 · 日志看板</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; background: #f5efe9; color: #3d2e24; padding: 32px; }
  h1 { font-size: 1.4rem; margin-bottom: 24px; display: flex; align-items: center; gap: 12px; }
  h1 small { font-size: .85rem; color: #9a8a7a; font-weight: 400; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .stat-card { background: #fff; border-radius: 12px; padding: 16px; border: 1px solid #e8ddd3; text-align: center; }
  .stat-card .num { font-size: 1.6rem; font-weight: 700; color: #d4784a; }
  .stat-card .label { font-size: .8rem; color: #9a8a7a; margin-top: 4px; }
  .section-title { font-size: 1rem; font-weight: 600; margin-bottom: 12px; margin-top: 28px; }
  .log-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; border: 1px solid #e8ddd3; }
  .log-table th { text-align: left; padding: 10px 14px; font-size: .78rem; color: #9a8a7a; background: #faf6f2; border-bottom: 1px solid #e8ddd3; }
  .log-table td { padding: 10px 14px; font-size: .85rem; border-bottom: 1px solid #f0e8e0; vertical-align: top; }
  .log-table tr:hover td { background: #fdf0e8; }
  .text-muted { color: #9a8a7a; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .72rem; font-weight: 600; }
  .tag-ok { background: #ecfdf5; color: #059669; }
  .tag-err { background: #fef2f2; color: #dc2626; }
  .tag-data { background: #eff6ff; color: #2563eb; }
  .max-w { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .no-data { text-align: center; padding: 48px; color: #bfb0a0; }
  .refresh { font-size: .8rem; color: #9a8a7a; cursor: pointer; }
  .refresh:hover { color: #d4784a; }
</style>
</head>
<body>
  <h1>📊 AI单号通 · 日志看板 <small id="liveCount"></small> <span class="refresh" onclick="location.reload()">⟳ 刷新</span></h1>
  <div class="stats" id="stats"></div>
  <div class="section-title">高频查询词</div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:20px" id="topQueries"></div>
  <div class="section-title">最近对话</div>
  <table class="log-table"><thead><tr><th>时间</th><th>用户输入</th><th>AI 回复</th><th>延迟</th><th>Token</th><th>状态</th></tr></thead><tbody id="logsBody"></tbody></table>
<script>
async function load() {
  const [statsRes, logsRes] = await Promise.all([fetch('/api/stats'), fetch('/api/logs?limit=50')])
  const stats = await statsRes.json()
  const { logs } = await logsRes.json()
  document.getElementById('stats').innerHTML = [
    ['💬 总对话', stats.total],['📅 今日', stats.todayCount],['⚡ 平均延迟', stats.avgLatency + 'ms'],
    ['📈 数据返回率', stats.dataRate + '%'],['❌ 错误率', stats.errorRate + '%'],['🎯 总 Token', stats.totalTokens.toLocaleString()]
  ].map(([l, n]) => '<div class="stat-card"><div class="num">' + n + '</div><div class="label">' + l + '</div></div>').join('')
  const tq = document.getElementById('topQueries')
  if (stats.topQueries.length) {
    tq.innerHTML = stats.topQueries.map(q => '<span style="padding:4px 12px;background:#fff;border:1px solid #e8ddd3;border-radius:999px;font-size:.8rem">' + q.word + ' <span style="color:#9a8a7a">×' + q.count + '</span></span>').join('')
  } else { tq.innerHTML = '<span class="text-muted">暂无数据</span>' }
  const tb = document.getElementById('logsBody')
  if (!logs.length) { tb.innerHTML = '<tr><td colspan="6" class="no-data">还没有日志数据</td></tr>'; return }
  tb.innerHTML = logs.map(l => {
    const ts = (l.timestamp || '').slice(11, 19)
    return '<tr class="' + (l.isError ? 'error-row' : '') + '"><td class="text-muted">' + ts + '</td><td class="max-w">' + (l.userInput || '').slice(0, 60) + '</td><td class="max-w">' + (l.aiResponse || '').slice(0, 120) + '</td><td class="text-muted">' + (l.latencyMs ? l.latencyMs + 'ms' : '-') + '</td><td class="text-muted">' + (l.tokens || '-') + '</td><td>' + (l.isError ? '<span class="tag tag-err">错误</span>' : l.hasData ? '<span class="tag tag-data">有数据</span>' : '<span class="tag tag-ok">纯文本</span>') + '</td></tr>'
  }).join('')
  document.getElementById('liveCount').textContent = '已记录 ' + stats.total + ' 条'
}
load(); setInterval(load, 30000)
</script>
</body>
</html>`)
})

export default app
