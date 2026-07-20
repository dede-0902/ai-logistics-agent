import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG_DIR = path.join(__dirname, 'logs')
const PORT = 3001

// 确保 logs 目录存在
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })

const app = express()
app.use(express.json())

/* ======================================================
   日志存储
   ====================================================== */
/** 今日日志文件路径 */
function todayLogPath() {
  const d = new Date()
  const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  return path.join(LOG_DIR, `${dateStr}.jsonl`)
}

/** 追加一条日志 */
function appendLog(entry) {
  const line = JSON.stringify({
    ...entry,
    _serverTime: new Date().toISOString(),
  }) + '\n'
  fs.appendFileSync(todayLogPath(), line, 'utf-8')
}

/** 读取最近的日志 */
function readLogs(limit = 100, offset = 0) {
  const p = todayLogPath()
  if (!fs.existsSync(p)) return { logs: [], total: 0 }

  const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean)
  const total = lines.length
  const slice = lines.reverse().slice(offset, offset + limit)
  const logs = slice.map(l => { try { return JSON.parse(l) } catch { return { _parseError: l } } })
  return { logs, total }
}

/** 读取所有历史日志文件 */
function readAllLogs(limit = 200) {
  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .reverse()

  const allLines = []
  for (const f of files) {
    const content = fs.readFileSync(path.join(LOG_DIR, f), 'utf-8')
    const lines = content.split('\n').filter(Boolean).reverse()
    for (const line of lines) {
      try { allLines.push(JSON.parse(line)) } catch {}
      if (allLines.length >= limit) break
    }
    if (allLines.length >= limit) break
  }
  return allLines
}

/* ======================================================
   API 路由
   ====================================================== */

/** 接收日志 */
app.post('/api/log', (req, res) => {
  const body = req.body || {}
  const entry = {
    timestamp: body.timestamp || new Date().toISOString(),
    sessionId: body.sessionId || '',
    conversationId: body.conversationId || '',
    userInput: body.userInput || '',
    aiResponse: body.aiResponse || '',
    latencyMs: body.latencyMs ?? 0,
    tokens: body.tokens ?? 0,
    hasData: body.hasData ?? false,
    isError: body.isError ?? false,
    errorMessage: body.errorMessage || '',
    userAgent: body.userAgent || '',
    referrer: body.referrer || '',
    inputLength: (body.userInput || '').length,
    responseLength: (body.aiResponse || '').length,
  }

  try {
    appendLog(entry)
    res.json({ ok: true, id: entry.timestamp })
  } catch (err) {
    console.error('写日志失败:', err)
    res.status(500).json({ ok: false, error: err.message })
  }
})

/** 获取日志列表 */
app.get('/api/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500)
  const offset = parseInt(req.query.offset) || 0
  const result = readLogs(limit, offset)
  res.json(result)
})

/** POST /api/coze — Coze 代理 */
app.post('/api/coze', async (req, res) => {
  const token = process.env.COZE_TOKEN || 'pat_3dzfQcYItGeXEiwEoIvitsBp7rqKSx60VOPiNAwAoxgP8FKIbY0obovp3Ysvxjl4'
  const { input, conversationName } = req.body || {}
  try {
    const cozeRes = await fetch('https://api.coze.cn/v1/workflows/chat', {
      method: 'POST', headers: {
        'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json',
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

/** 聚合统计 */
app.get('/api/stats', (req, res) => {
  const logs = readAllLogs(500)

  const total = logs.length
  const errors = logs.filter(l => l.isError).length
  const withData = logs.filter(l => l.hasData).length
  const latencies = logs.map(l => l.latencyMs).filter(l => l > 0)
  const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0
  const maxLatency = latencies.length ? Math.max(...latencies) : 0
  const totalTokens = logs.reduce((s, l) => s + (l.tokens || 0), 0)

  // 今日数量
  const today = new Date().toISOString().slice(0, 10)
  const todayLogs = logs.filter(l => (l.timestamp || '').startsWith(today))

  // 高频用户输入 TOP10
  const wordCount = {}
  logs.forEach(l => {
    if (l.userInput) {
      // 简单分词取关键词
      const text = l.userInput.replace(/[^一-龥a-zA-Z0-9]/g, ' ')
      const words = text.split(/\s+/).filter(Boolean)
      words.forEach(w => {
        if (w.length >= 2) wordCount[w] = (wordCount[w] || 0) + 1
      })
    }
  })
  const topQueries = Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }))

  res.json({
    total,
    errors,
    errorRate: total ? Math.round(errors / total * 100) : 0,
    withData,
    dataRate: total ? Math.round(withData / total * 100) : 0,
    avgLatency,
    maxLatency,
    totalTokens,
    todayCount: todayLogs.length,
    topQueries,
  })
})

/* ======================================================
   管理看板（纯 HTML）
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
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
    background: #f5efe9; color: #3d2e24; padding: 32px;
  }
  h1 { font-size: 1.4rem; margin-bottom: 24px; display: flex; align-items: center; gap: 12px; }
  h1 small { font-size: .85rem; color: #9a8a7a; font-weight: 400; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .stat-card {
    background: #fff; border-radius: 12px; padding: 16px; border: 1px solid #e8ddd3;
    text-align: center;
  }
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

  .error-row td { background: #fff5f5; }
</style>
</head>
<body>
  <h1>
    📊 AI单号通 · 日志看板
    <small id="liveCount"></small>
    <span class="refresh" onclick="location.reload()">⟳ 刷新</span>
  </h1>

  <div class="stats" id="stats"></div>

  <div class="section-title">高频查询词</div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:20px" id="topQueries"></div>

  <div class="section-title">最近对话</div>
  <table class="log-table">
    <thead><tr>
      <th>时间</th><th>用户输入</th><th>AI 回复</th><th>延迟</th><th>Token</th><th>状态</th>
    </tr></thead>
    <tbody id="logsBody"></tbody>
  </table>

<script>
async function load() {
  const [statsRes, logsRes] = await Promise.all([
    fetch('/api/stats'),
    fetch('/api/logs?limit=50'),
  ])
  const stats = await statsRes.json()
  const { logs } = await logsRes.json()

  // stats
  document.getElementById('stats').innerHTML = [
    ['💬 总对话', stats.total],
    ['📅 今日', stats.todayCount],
    ['⚡ 平均延迟', stats.avgLatency + 'ms'],
    ['📈 数据返回率', stats.dataRate + '%'],
    ['❌ 错误率', stats.errorRate + '%'],
    ['🎯 总 Token', stats.totalTokens.toLocaleString()],
  ].map(([l, n]) => '<div class="stat-card"><div class="num">' + n + '</div><div class="label">' + l + '</div></div>').join('')

  // top queries
  const tq = document.getElementById('topQueries')
  if (stats.topQueries.length) {
    tq.innerHTML = stats.topQueries.map(q =>
      '<span style="padding:4px 12px;background:#fff;border:1px solid #e8ddd3;border-radius:999px;font-size:.8rem">'
      + q.word + ' <span style="color:#9a8a7a">×' + q.count + '</span></span>'
    ).join('')
  } else {
    tq.innerHTML = '<span class="text-muted">暂无数据</span>'
  }

  // logs
  const tbody = document.getElementById('logsBody')
  if (!logs.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="no-data">还没有日志数据，打开 AI 单号通聊几句看看</td></tr>'
    return
  }

  tbody.innerHTML = logs.map(l => {
    const ts = (l.timestamp || '').slice(11, 19)
    const input = (l.userInput || '').slice(0, 60)
    const response = (l.aiResponse || '').slice(0, 120)
    const latency = l.latencyMs ? l.latencyMs + 'ms' : '-'
    const tokens = l.tokens || '-'
    let status = l.isError
      ? '<span class="tag tag-err">错误</span>'
      : l.hasData
        ? '<span class="tag tag-data">有数据</span>'
        : '<span class="tag tag-ok">纯文本</span>'
    return '<tr class="' + (l.isError ? 'error-row' : '') + '">'
      + '<td class="text-muted">' + ts + '</td>'
      + '<td class="max-w" title="' + (l.userInput || '') + '">' + input + '</td>'
      + '<td class="max-w" title="' + (l.aiResponse || '') + '">' + response + '</td>'
      + '<td class="text-muted">' + latency + '</td>'
      + '<td class="text-muted">' + tokens + '</td>'
      + '<td>' + status + '</td>'
      + '</tr>'
  }).join('')

  document.getElementById('liveCount').textContent = '已记录 ' + stats.total + ' 条'
}
load()
// 每 30 秒自动刷新
setInterval(load, 30000)
</script>
</body>
</html>`)
})

app.listen(PORT, () => {
  console.log('📊 日志服务器运行在 http://localhost:' + PORT)
  console.log('   看板地址: http://localhost:' + PORT + '/admin')
})
