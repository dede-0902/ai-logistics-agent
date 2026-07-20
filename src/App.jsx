import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

/* ========== 配置 ========== */
const API = import.meta.env.VITE_API_BASE || ''

// Coze 直接从浏览器调用（不经过 Vercel 代理，避免 10s 超时）
const COZE_TOKEN = 'pat_3dzfQcYItGeXEiwEoIvitsBp7rqKSx60VOPiNAwAoxgP8FKIbY0obovp3Ysvxjl4'
const WORKFLOW_ID = '7663285609365225499'
const COZE_API = 'https://api.coze.cn/v1/workflows/chat'

const WELCOME_MSG = '你好呀😊！我是你的快递物流查询小助手，输入**快递单号**，我帮你查询物流进度并生成客服话术～'

// 生成随机会话 ID
function genId() { return 'session_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) }

/* ========== 头像 ========== */
function Avatar({ role }) {
  return (
    <div className={`avatar ${role === 'ai' ? 'avatar-ai' : 'avatar-user'}`}>
      {role === 'ai' ? '🤖' : '👤'}
    </div>
  )
}

/* ========== 消息气泡 ========== */
function Message({ msg, isRevealing }) {
  const display = isRevealing ? msg.text.slice(0, msg._revealed) : msg.text
  const showCursor = isRevealing && msg._revealed < msg.text.length

  return (
    <div className={`message-row ${msg.role}`}>
      <Avatar role={msg.role} />
      <div className={`bubble ${msg.role === 'ai' ? 'bubble-ai' : 'bubble-user'} ${showCursor ? 'cursor' : ''}`}>
        {display}
      </div>
    </div>
  )
}

/* ========== 输入中动画 ========== */
function TypingIndicator({ statusText }) {
  return (
    <div className="message-row ai">
      <Avatar role="ai" />
      <div className="bubble bubble-ai typing-indicator">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
        {statusText && <span className="typing-text">{statusText}</span>}
      </div>
    </div>
  )
}

/* ========== 格式化最终回复 ========== */
function formatResponse(data) {
  // 纯文本（非 JSON 结构）
  if (data._raw) return data._raw

  const parts = []
  if (data.kdjd) parts.push(`📦 **物流进度**\n${data.kdjd}`)
  if (data.output) parts.push(`💬 **回复话术**\n${data.output}`)
  if (data.risk && data.risk !== '正常') parts.push(`⚠️ **风险提醒**\n${data.risk}`)
  return parts.length > 0
    ? parts.join('\n\n——\n\n')
    : '暂时没有查到相关信息，请检查快递单号是否正确～'
}

/* ========== 主组件 ========== */
function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isRevealing, setIsRevealing] = useState(false)
  const [typingText, setTypingText] = useState('')
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const chatRef = useRef(null)
  const revealIdRef = useRef(null)
  const convNameRef = useRef(genId())

  const scrollToBottom = useCallback((smooth = true) => {
    const el = chatRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  const isNearBottom = useCallback(() => {
    const el = chatRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }, [])

  useEffect(() => {
    const el = chatRef.current
    if (!el) return
    const onScroll = () => setShowScrollBtn(!isNearBottom())
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [isNearBottom])

  useEffect(() => {
    if (isNearBottom()) {
      scrollToBottom()
    } else if (!isTyping && !isRevealing) {
      setShowScrollBtn(true)
    }
  }, [messages, isTyping, isRevealing, isNearBottom, scrollToBottom])

  useEffect(() => {
    setMessages([{ role: 'ai', text: WELCOME_MSG }])
  }, [])

  const delay = (ms) => new Promise(r => setTimeout(r, ms))

  /* AI 逐字输出 */
  const typeAiMessage = async (text) => {
    setIsTyping(true)
    setTypingText('')
    await delay(800)

    setIsTyping(false)
    setIsRevealing(true)

    const id = Symbol()
    revealIdRef.current = id

    setMessages(prev => [...prev, { role: 'ai', text, _revealed: 0 }])
    await new Promise(r => requestAnimationFrame(r))

    return new Promise((resolve) => {
      let revealed = 0
      const tick = () => {
        if (revealIdRef.current !== id) { resolve(); return }
        revealed += 2
        if (revealed >= text.length) {
          setMessages(prev => {
            const copy = [...prev]
            copy[copy.length - 1] = { ...copy[copy.length - 1], _revealed: text.length }
            return copy
          })
          setIsRevealing(false)
          resolve()
          return
        }
        setMessages(prev => {
          const copy = [...prev]
          copy[copy.length - 1] = { ...copy[copy.length - 1], _revealed: revealed }
          return copy
        })
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }

  /** 上报日志到后端 */
  const reportLog = useCallback(async (data) => {
    try {
      await fetch(API + '/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    } catch {}
  }, [])

  /** 获取浏览器信息 */
  function getBrowserInfo() {
    return navigator.userAgent || ''
  }

  /* 发送消息 */
  const handleSend = useCallback(async (text) => {
    const t = text.trim()
    if (!t || isTyping || isRevealing) return

    const startTime = performance.now()
    const convName = convNameRef.current

    setMessages(prev => [...prev, { role: 'user', text: t }])
    setInput('')
    scrollToBottom()
    await delay(200)

    setIsTyping(true)
    setTypingText('处理中...')

    try {
      const result = await callCozeChatWithProgress(t, convName, setTypingText)
      const isStructured = result.kdjd !== undefined || result.output !== undefined
      const reply = isStructured ? formatResponse(result) : (result._raw || '')

      setIsTyping(false)
      await typeAiMessage(reply)

      // 上报日志（不阻塞 UI）
      const latencyMs = Math.round(performance.now() - startTime)
      reportLog({
        timestamp: new Date().toISOString(),
        sessionId: convName,
        conversationId: result._convId || '',
        userInput: t,
        aiResponse: reply,
        latencyMs,
        tokens: result._tokens || 0,
        hasData: isStructured,
        isError: false,
        errorMessage: '',
        userAgent: getBrowserInfo(),
        referrer: document.referrer || '',
      })
    } catch (err) {
      setIsTyping(false)
      const errorMsg = `😅 查询出错了：${err.message}\n\n请检查快递单号是否正确，或稍后再试～`
      await typeAiMessage(errorMsg)

      // 上报错误日志
      const latencyMs = Math.round(performance.now() - startTime)
      reportLog({
        timestamp: new Date().toISOString(),
        sessionId: convName,
        conversationId: '',
        userInput: t,
        aiResponse: errorMsg,
        latencyMs,
        tokens: 0,
        hasData: false,
        isError: true,
        errorMessage: err.message,
        userAgent: getBrowserInfo(),
        referrer: document.referrer || '',
      })
    }
  }, [isTyping, isRevealing, scrollToBottom, reportLog])

  /* 调用 Coze API（直接从浏览器，不走 Vercel 代理） */
  const callCozeChatWithProgress = async (input, convName, onProgress) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 90000)

    try {
      const res = await fetch(COZE_API, {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${COZE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflow_id: WORKFLOW_ID,
          additional_messages: [{
            role: 'user',
            content_type: 'text',
            content: input.trim(),
          }],
          parameters: { CONVERSATION_NAME: convName },
        }),
      })

      if (!res.ok) throw new Error(`API 请求失败 (${res.status})`)

      // 等整个响应体送达再解析（避免流式读取跨域问题）
      const fullText = await res.text()

      // 按行切割 SSE
      const lines = fullText.split('\n')
      let lastAnswerText = null
      let convId = ''
      let tokenUsage = 0

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        if (line.startsWith('event: ')) {
          const evt = line.slice(7).trim()

          // 找到这一 event 对应的 data 行
          let dataLine = ''
          for (let j = i + 1; j < lines.length; j++) {
            const next = lines[j]
            if (next.startsWith('data: ')) {
              dataLine = next.slice(6)
              break
            }
            if (next.startsWith('event: ') || next === '') continue
          }

          if (!dataLine) continue
          const data = tryParseJSON(dataLine)
          if (!data) continue

          if (evt === 'conversation.chat.created' && data.conversation_id) {
            convId = data.conversation_id
          }

          if (evt === 'conversation.message.delta' && data.type === 'answer' && data.content) {
            onProgress(typeof data.content === 'string' ? data.content : JSON.stringify(data.content))
          }

          if (evt === 'conversation.message.completed' && data.type === 'answer' && data.content) {
            lastAnswerText = data.content
          }

          if (evt === 'conversation.chat.completed') {
            if (data.usage) tokenUsage = data.usage.token_count || data.usage.total_tokens || 0
            if (data.last_error && data.last_error.code !== 0) {
              throw new Error(data.last_error.msg || '工作流执行失败')
            }
          }
        }
      }

      if (!lastAnswerText) throw new Error('未能获取到查询结果')

      // 尝试解析为 JSON（kdjd/output/risk 格式）
      const json = tryParseJSON(lastAnswerText)
      if (json && (json.kdjd !== undefined || json.output !== undefined)) {
        return { ...json, _convId: convId, _tokens: tokenUsage }
      }

      // 否则当成纯文本直接返回
      return { _raw: lastAnswerText, _convId: convId, _tokens: tokenUsage }
    } finally {
      clearTimeout(timeout)
    }
  }

  function tryParseJSON(str) {
    if (!str || typeof str !== 'string') return null
    try { return JSON.parse(str) } catch { return null }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSend(input) }
  }

  const handleScrollBtn = () => { scrollToBottom(); setShowScrollBtn(false) }

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="status-dot" />
          <div>
            <div className="header-title">AI单号通</div>
            <div className="header-badge">
              {isTyping || isRevealing ? (
                <span className="header-typing">正在输入中...</span>
              ) : (
                <><span>在线</span><span> · </span><span>响应快速</span></>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="chat-area" ref={chatRef}>
        {messages.map((msg, i) => (
          <Message
            key={i}
            msg={msg}
            isRevealing={isRevealing && i === messages.length - 1 && msg.role === 'ai'}
          />
        ))}
        {isTyping && <TypingIndicator statusText={typingText} />}
        {showScrollBtn && (
          <button className="scroll-btn" onClick={handleScrollBtn}>↓ 新消息</button>
        )}
      </div>

      <div className="input-area">
        <div className="input-wrapper">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入快递单号..."
            disabled={isTyping || isRevealing}
            autoFocus
          />
        </div>
        <button
          className="send-btn"
          onClick={() => handleSend(input)}
          disabled={!input.trim() || isTyping || isRevealing}
        >↑</button>
      </div>
    </div>
  )
}

export default App
