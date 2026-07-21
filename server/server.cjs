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
app.get('/api/stats', (req, res) => {
  const total = logs.length
  res.json({ total })
})

// Admin 看板
app.get('/admin', (req, res) => {
  const total = logs.length
  const errors = logs.filter(l => l.isError).length
  const wd = logs.filter(l => l.hasData).length
  const lat = logs.map(l => l.latencyMs).filter(Boolean)
  const avg = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0
  const wc = {}
  logs.forEach(l => { if (l.userInput) l.userInput.replace(/[^一-龥a-zA-Z0-9]/g, ' ').split(/\s+/).filter(Boolean).forEach(w => { if (w.length >= 2) wc[w] = (wc[w] || 0) + 1 }) })
  const stats = JSON.stringify({
    total, errors, errorRate: total ? Math.round(errors/total*100) : 0, withData: wd,
    dataRate: total ? Math.round(wd/total*100) : 0, avgLatency: avg,
    todayCount: logs.filter(l => l.timestamp?.startsWith(new Date().toISOString().slice(0, 10))).length,
    totalTokens: logs.reduce((s, l) => s + (l.tokens||0), 0),
    topQueries: Object.entries(wc).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w, c]) => ({ word: w, count: c })),
  })
  res.send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>看板</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;background:#f5efe9;color:#3d2e24;padding:32px}
h1{font-size:1.4rem}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:28px}
.stat-card{background:#fff;border-radius:12px;padding:16px;border:1px solid #e8ddd3;text-align:center}
.stat-card .num{font-size:1.6rem;font-weight:700;color:#d4784a}.stat-card .label{font-size:.8rem;color:#9a8a7a;margin-top:4px}
.log-table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;border:1px solid #e8ddd3}
.log-table th{text-align:left;padding:10px 14px;font-size:.78rem;color:#9a8a7a;background:#faf6f2;border-bottom:1px solid #e8ddd3}
.log-table td{padding:10px 14px;font-size:.85rem;border-bottom:1px solid #f0e8e0}
.tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:600}
.tag-ok{background:#ecfdf5;color:#059669}.tag-err{background:#fef2f2;color:#dc2626}.tag-data{background:#eff6ff;color:#2563eb}
.text-muted{color:#9a8a7a}
</style></head><body>
<h1>📊 看板 <small id="c"></small> <span style="font-size:.8rem;color:#9a8a7a;cursor:pointer" onclick="location.reload()">⟳</span></h1>
<div class="stats" id="s"></div><div id="tq" style="margin-bottom:20px;display:flex;flex-wrap:wrap;gap:6px"></div>
<table class="log-table"><thead><tr><th>时间</th><th>输入</th><th>回复</th><th>延迟</th><th>Token</th><th>状态</th></tr></thead><tbody id="b"></tbody></table>
<script>
const D=${stats}
document.getElementById('s').innerHTML=[['💬 总',D.total],['📅 今日',D.todayCount],['⚡ 延迟',D.avgLatency+'ms'],['📈 数据率',D.dataRate+'%'],['❌ 错误率',D.errorRate+'%'],['🎯 Token',D.totalTokens.toLocaleString()]].map(([l,n])=>'<div class="stat-card"><div class="num">'+n+'</div><div class="label">'+l+'</div></div>').join('')
document.getElementById('tq').innerHTML=D.topQueries.length?D.topQueries.map(x=>'<span style="padding:2px 10px;background:#fff;border:1px solid #e8ddd3;border-radius:999px;font-size:.8rem">'+x.word+' <span style="color:#9a8a7a">'+x.count+'</span></span>').join(''):'暂无'
fetch('/api/logs?limit=50').then(r=>r.json()).then(({logs})=>{
document.getElementById('b').innerHTML=logs.length?logs.map(l=>'<tr><td class="text-muted">'+(l.timestamp||'').slice(11,19)+'</td><td>'+((l.userInput||'').slice(0,40))+'</td><td>'+((l.aiResponse||'').slice(0,80))+'</td><td class="text-muted">'+(l.latencyMs?l.latencyMs+'ms':'-')+'</td><td class="text-muted">'+(l.tokens||'-')+'</td><td>'+(l.isError?'<span class="tag tag-err">错</span>':l.hasData?'<span class="tag tag-data">数据</span>':'<span class="tag tag-ok">文本</span>')+'</td></tr>').join(''):'<tr><td colspan="6" style="text-align:center;padding:24px;color:#aaa">暂无</td></tr>'
document.getElementById('c').textContent='共 '+D.total+' 条'})
</script></body></html>`)
})

app.listen(3001, () => console.log('Local server on :3001'))
