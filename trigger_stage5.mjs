// 实际触发 productionAgent 跑阶段 5
// 1) HTTP 登录拿 token
// 2) socket.io 连接 /api/socket/productionAgent
// 3) 发 chat 事件，决策层派发到执行层
// 4) 监听所有 socket 事件，打印；超时后查 o_storyboard

import { io } from 'socket.io-client';

const HOST = 'http://localhost:10588';
const PROJECT_ID = 1786508409458;
const SCRIPT_ID = 1;

async function login() {
  const res = await fetch(HOST + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'fireabyss', password: 'yY19841115.' }),
  });
  const j = await res.json();
  if (!j.success) throw new Error('login failed: ' + JSON.stringify(j));
  // 服务端返回的是 "Bearer <jwt>"
  return j.data.token;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const isolationKey = `${PROJECT_ID}:productionAgent:${SCRIPT_ID}`;
    const sock = io(HOST + '/api/socket/productionAgent', {
      transports: ['websocket'],
      auth: {
        token,
        projectId: PROJECT_ID,
        scriptId: SCRIPT_ID,
        isolationKey,
      },
      reconnection: false,
      timeout: 5000,
    });

    sock.on('connect', () => {
      console.log('[sock] connected', sock.id);
      resolve(sock);
    });
    sock.on('connect_error', e => reject(e));
    setTimeout(() => reject(new Error('connect timeout')), 8000);
  });
}

async function main() {
  console.log('1) login');
  const token = await login();
  console.log('   token len:', token.length);

  console.log('2) connect socket');
  const sock = await connect(token);

  // 记录所有事件
  const events = [];
  const onevent = (name) => sock.on(name, (payload, ack) => {
    const summary = typeof payload === 'object' ? Object.keys(payload ?? {}).join(',') : String(payload);
    events.push({ name, t: Date.now(), keys: summary, ack: typeof ack === 'function' });
    console.log(`[event] ${name} keys=${summary} ${typeof ack === 'function' ? '(has ack)' : ''}`);
  });
  ['message', 'messageUpdate', 'messageFinish', 'messageError', 'messageStop',
   'thinking', 'thinkingUpdate', 'thinkingFinish', 'thinkingStop',
   'toolCall', 'toolResult', 'error', 'addStoryboard',
  ].forEach(onevent);

  // 同步 updateContext（按前端模式）
  sock.emit('updateContext', {
    isolationKey: `${PROJECT_ID}:productionAgent:${SCRIPT_ID}`,
    projectId: PROJECT_ID,
    scriptId: SCRIPT_ID,
  }, (r) => console.log('[updateContext ack]', r));

  console.log('3) send chat — trigger stage 5');
  // 用户消息：直接要求执行阶段 5（首位帧模式，因为 videoModel 多参=否）
  const userMsg = '请执行阶段 5：分镜面板写入，使用首位帧模式。';
  sock.emit('chat', { content: userMsg });

  // 等 90s 看是否执行层被调用
  console.log('4) waiting 90s for execution layer to run...');
  await new Promise(r => setTimeout(r, 90000));

  console.log('\n5) disconnect');
  sock.disconnect();

  console.log('\n=== event summary ===');
  const counts = {};
  for (const e of events) counts[e.name] = (counts[e.name] || 0) + 1;
  console.log(counts);

  // 关键：addStoryboard 出现了多少次？
  console.log('\naddStoryboard events:', events.filter(e => e.name === 'addStoryboard').length);
}

main().catch(e => { console.error(e); process.exit(1); });