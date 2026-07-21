// Cloudflare Pages _worker.js — 处理 API + Admin，静态文件交给 ASSETS
const logs = []
let logId = 0

const ADMIN_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>看板</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;background:#f5efe9;color:#3d2e24;padding:32px}
h1{font-size:1.4rem}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.stat-card{background:#fff;border-radius:12px;padding:16px;border:1px solid #e8ddd3;text-align:center}
.stat-card .num{font-size:1.6rem;font-weight:700;color:#d4784a}.stat-card .label{font-size:.8rem;color:#9a8a7a;margin-top:4px}
.log-table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;border:1px solid #e8ddd3}
.log-table th{text-align:left;padding:8px 12px;font-size:.78rem;color:#9a8a7a;background:#faf6f2}
.log-table td{padding:8px 12px;font-size:.85rem;border-top:1px solid #f0e8e0}
.tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:600}
.tag-ok{background:#ecfdf5;color:#059669}.tag-err{background:#fef2f2;color:#dc2626}.tag-data{background:#eff6ff;color:#2563eb}
</style></head><body>
<h1>📊 看板 <small id="c"></small></h1>
<div class="stats" id="s"></div><div id="tq" style="margin:12px 0"></div>
<table class="log-table"><thead><tr><th>时间</th><th>输入</th><th>回复</th><th>状态</th></tr></thead><tbody id="b"></tbody></table>
<script>
async function load(){const r=await fetch('/api/stats'),l=await fetch('/api/logs?limit=50');const t=await r(),{logs}=await l()
document.getElementById('s').innerHTML=[['💬',t.total],['📅',t.todayCount],['⚡',t.avgLatency+'ms'],['📈',t.dataRate+'%'],['❌',t.errorRate+'%']].map(([l,n])=>'<div class="stat-card"><div class="num">'+n+'</div><div class="label">'+l+'</div></div>').join('')
document.getElementById('tq').innerHTML=t.topQueries.length?'高頻: '+t.topQueries.map(x=>'<span style="padding:2px 8px;background:#fff;border:1px solid #e8ddd3;border-radius:999px;font-size:.8rem">'+x.word+' <span style="color:#999">'+x.count+'</span></span>').join(' '):''
document.getElementById('b').innerHTML=logs.length?logs.map(l=>'<tr><td class="text-muted">'+(l.timestamp||'').slice(11,19)+'</td><td>'+((l.userInput||'').slice(0,30))+'</td><td>'+((l.aiResponse||'').slice(0,60))+'</td><td>'+(l.isError?'<span class="tag tag-err">错</span>':l.hasData?'<span class="tag tag-data">数据</span>':'<span class="tag tag-ok">文本</span>')+'</td></tr>').join(''):'<tr><td colspan="4" style="text-align:center;color:#aaa;padding:24px">暂无数据</td></tr>'
document.getElementById('c').textContent='共 '+t.total+' 条'}
load();setInterval(load,30000)
</script></body></html>`

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      // === API 路由 ===
      const method = request.method

      // POST /api/log
      if (path === '/api/log' && method === 'POST') {
        const b = await request.json()
        logs.unshift({
          id: ++logId, timestamp: b.timestamp || new Date().toISOString(),
          sessionId: b.sessionId || '', conversationId: b.conversationId || '',
          userInput: (b.userInput || '').slice(0, 500),
          aiResponse: (b.aiResponse || '').slice(0, 2000),
          latencyMs: b.latencyMs ?? 0, tokens: b.tokens ?? 0,
          hasData: b.hasData ?? false, isError: b.isError ?? false,
          errorMessage: b.errorMessage || '',
        })
        if (logs.length > 2000) logs.length = 2000
        return json({ ok: true })
      }

      // POST /api/coze
      if (path === '/api/coze' && method === 'POST') {
        const token = env.COZE_TOKEN
        if (!token) return json({ error: 'COZE_TOKEN not set' }, 500)
        const { input, conversationName } = await request.json()
        const r = await fetch('https://api.coze.cn/v1/workflows/chat', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflow_id: '7663285609365225499',
            additional_messages: [{ role: 'user', content_type: 'text', content: input }],
            parameters: { CONVERSATION_NAME: conversationName || 'web_' + Date.now() },
          }),
        })
        return new Response(await r.text(), { headers: { 'content-type': 'text/event-stream' } })
      }

      // GET /api/logs
      if (path === '/api/logs') return json({ logs: logs.slice(0, 100), total: logs.length })

      // GET /api/stats
      if (path === '/api/stats') {
        const total = logs.length, e = logs.filter(l => l.isError).length, wd = logs.filter(l => l.hasData).length
        const lat = logs.map(l => l.latencyMs).filter(Boolean)
        const avg = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0
        const wc = {}
        logs.forEach(l => { if (l.userInput) l.userInput.replace(/[^一-龥a-zA-Z0-9]/g, ' ').split(/\s+/).filter(Boolean).forEach(w => { if (w.length >= 2) wc[w] = (wc[w] || 0) + 1 }) })
        return json({ total, errors: e, errorRate: total ? Math.round(e / total * 100) : 0, withData: wd, dataRate: total ? Math.round(wd / total * 100) : 0, avgLatency: avg, todayCount: logs.filter(l => l.timestamp?.startsWith(new Date().toISOString().slice(0, 10))).length, totalTokens: logs.reduce((s, l) => s + (l.tokens || 0), 0), topQueries: Object.entries(wc).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w, c]) => ({ word: w, count: c })) })
      }

      // GET /admin
      if (path === '/admin') return new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })

    } catch (e) {
      return json({ error: e.message }, 500)
    }

    // 非 API 路由 → 静态文件
    return env.ASSETS.fetch(request)
  },
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
