/**
 * Cloudflare Pages _worker.js — 处理所有请求
 * API/Admin 走这里，静态文件转发给 Pages 托管
 */
const logs = []
let logId = 0

const ADMIN_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>看板</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;background:#f5efe9;color:#3d2e24;padding:32px}
h1{font-size:1.4rem}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:28px}
.stat-card{background:#fff;border-radius:12px;padding:16px;border:1px solid #e8ddd3;text-align:center}
.stat-card .num{font-size:1.6rem;font-weight:700;color:#d4784a}.stat-card .label{font-size:.8rem;color:#9a8a7a;margin-top:4px}
.log-table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8ddd3}
.log-table th{text-align:left;padding:10px 14px;font-size:.78rem;color:#9a8a7a;background:#faf6f2;border-bottom:1px solid #e8ddd3}
.log-table td{padding:10px 14px;font-size:.85rem;border-bottom:1px solid #f0e8e0;vertical-align:top}
.tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:600}
.tag-ok{background:#ecfdf5;color:#059669}.tag-err{background:#fef2f2;color:#dc2626}.tag-data{background:#eff6ff;color:#2563eb}
.text-muted{color:#9a8a7a}
</style></head><body>
<h1>📊 看板 <small id="c"></small> <span style="font-size:.8rem;color:#9a8a7a;cursor:pointer" onclick="location.reload()">⟳</span></h1>
<div class="stats" id="s"></div><div id="tq" style="margin-bottom:20px;display:flex;flex-wrap:wrap;gap:6px"></div>
<table class="log-table"><thead><tr><th>时间</th><th>输入</th><th>回复</th><th>延迟</th><th>Token</th><th>状态</th></tr></thead><tbody id="b"></tbody></table>
<script>
async function load(){const[r,l]=await Promise.all([fetch('/api/stats'),fetch('/api/logs?limit=50')]);const t=await r(),{logs}=await l()
document.getElementById('s').innerHTML=[['💬 总',t.total],['📅 今日',t.todayCount],['⚡ 延迟',t.avgLatency+'ms'],['📈 数据率',t.dataRate+'%'],['❌ 错误率',t.errorRate+'%'],['🎯 Token',t.totalTokens.toLocaleString()]].map(([l,n])=>'<div class="stat-card"><div class="num">'+n+'</div><div class="label">'+l+'</div></div>').join('')
document.getElementById('tq').innerHTML=t.topQueries.length?'高频: '+t.topQueries.map(x=>'<span style="padding:2px 10px;background:#fff;border:1px solid #e8ddd3;border-radius:999px;font-size:.8rem">'+x.word+' <span style="color:#9a8a7a">'+x.count+'</span></span>').join(''):'暂无数据'
document.getElementById('b').innerHTML=logs.length?logs.map(l=>'<tr><td class="text-muted">'+(l.timestamp||'').slice(11,19)+'</td><td>'+((l.userInput||'').slice(0,40))+'</td><td>'+((l.aiResponse||'').slice(0,80))+'</td><td class="text-muted">'+(l.latencyMs?l.latencyMs+'ms':'-')+'</td><td class="text-muted">'+(l.tokens||'-')+'</td><td>'+(l.isError?'<span class="tag tag-err">错</span>':l.hasData?'<span class="tag tag-data">数据</span>':'<span class="tag tag-ok">文本</span>')+'</td></tr>').join(''):'<tr><td colspan="6" style="text-align:center;padding:24px;color:#aaa">暂无数据</td></tr>'
document.getElementById('c').textContent='共 '+t.total+' 条'}
load();setInterval(load,30000)
</script></body></html>`

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const pathname = url.pathname

    // API 和 Admin 路由
    if (pathname.startsWith('/api/') || pathname === '/admin') {
      try {
        const method = request.method
        let body = ''
        if (method === 'POST' || method === 'PUT') body = await request.text()

        // POST /api/log
        if (pathname === '/api/log' && method === 'POST') {
          try {
            const b = JSON.parse(body)
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
          } catch { return json({ error: 'bad request' }, 400) }
        }

        // POST /api/coze — Coze 代理（Token 在环境变量里）
        if (pathname === '/api/coze' && method === 'POST') {
          const token = env.COZE_TOKEN
          if (!token) return json({ error: 'COZE_TOKEN not configured' }, 500)
          try {
            const { input, conversationName } = JSON.parse(body)
            const cozeRes = await fetch('https://api.coze.cn/v1/workflows/chat', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                workflow_id: '7663285609365225499',
                additional_messages: [{ role: 'user', content_type: 'text', content: input }],
                parameters: { CONVERSATION_NAME: conversationName || 'web_' + Date.now() },
              }),
            })
            const text = await cozeRes.text()
            return new Response(text, { headers: { 'content-type': 'text/event-stream' } })
          } catch (e) { return json({ error: e.message }, 500) }
        }

        // GET /api/logs
        if (pathname === '/api/logs') return json({ logs: logs.slice(0, 100), total: logs.length })

        // GET /api/stats
        if (pathname === '/api/stats') {
          const total = logs.length, errors = logs.filter(l => l.isError).length, wd = logs.filter(l => l.hasData).length
          const lat = logs.map(l => l.latencyMs).filter(Boolean)
          const avg = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0
          const wc = {}
          logs.forEach(l => { if (l.userInput) l.userInput.replace(/[^一-龥a-zA-Z0-9]/g, ' ').split(/\s+/).filter(Boolean).forEach(w => { if (w.length >= 2) wc[w] = (wc[w] || 0) + 1 }) })
          return json({
            total, errors, errorRate: total ? Math.round(errors / total * 100) : 0,
            withData: wd, dataRate: total ? Math.round(wd / total * 100) : 0,
            avgLatency: avg, todayCount: logs.filter(l => l.timestamp?.startsWith(new Date().toISOString().slice(0, 10))).length,
            totalTokens: logs.reduce((s, l) => s + (l.tokens || 0), 0),
            topQueries: Object.entries(wc).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w, c]) => ({ word: w, count: c })),
          })
        }

        // GET /admin
        if (pathname === '/admin') {
          return new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
        }

        return new Response('Not Found', { status: 404 })
      } catch (e) {
        return json({ error: e.message }, 500)
      }
    }

    // 静态文件→ 交给 Pages 托管
    return env.ASSETS.fetch(request)
  },
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
  })
}
