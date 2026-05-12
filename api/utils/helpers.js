// API工具函数

// 生成唯一ID
export function generateId() {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}

// 读取JSON文件
async function readJSON(filename) {
  const fs = require('fs').promises;
  try {
    const data = await fs.readFile(filename, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []; // 文件不存在，返回空数组
    }
    throw error;
  }
}

// 写入JSON文件
async function writeJSON(filename, data) {
  const fs = require('fs').promises;
  await fs.writeFile(filename, JSON.stringify(data, null, 2), 'utf8');
}

// 用户相关操作
export async function getUsers() {
  return await readJSON('data/users.json');
}

export async function getUserByPhone(phone) {
  const users = await getUsers();
  return users.find(u => u.phone === phone);
}

export async function getUserByWechatOpenID(openid) {
  const users = await getUsers();
  return users.find(u => u.wechat_openid === openid);
}

export async function getUser(userId) {
  const users = await getUsers();
  return users.find(u => u.user_id === userId);
}

export async function createUser(userData) {
  const users = await getUsers();
  const newUser = {
    user_id: generateId(),
    ...userData,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  users.push(newUser);
  await writeJSON('data/users.json', users);
  return newUser;
}

export async function updateUser(userId, updates) {
  const users = await getUsers();
  const index = users.findIndex(u => u.user_id === userId);
  if (index !== -1) {
    users[index] = {
      ...users[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    await writeJSON('data/users.json', users);
    return users[index];
  }
  return null;
}

// 验证码相关操作
export async function getVerificationCodes() {
  return await readJSON('data/verification_codes.json');
}

export async function saveVerificationCodes(codes) {
  await writeJSON('data/verification_codes.json', codes);
}

// 会话相关操作
export async function getSessions() {
  return await readJSON('data/sessions.json');
}

export async function createSession(userId) {
  const sessions = await getSessions();
  const session = {
    session_id: generateId(),
    user_id: userId,
    token: null, // 稍后生成
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7天
    last_activity: new Date().toISOString()
  };
  sessions.push(session);
  await writeJSON('data/sessions.json', sessions);
  return session;
}

export async function getSession(sessionId) {
  const sessions = await getSessions();
  return sessions.find(s => s.session_id === sessionId);
}

export async function updateSessionActivity(sessionId) {
  const sessions = await getSessions();
  const index = sessions.findIndex(s => s.session_id === sessionId);
  if (index !== -1) {
    sessions[index].last_activity = new Date().toISOString();
    await writeJSON('data/sessions.json', sessions);
    return sessions[index];
  }
  return null;
}

export async function deleteSession(sessionId) {
  const sessions = await getSessions();
  const filtered = sessions.filter(s => s.session_id !== sessionId);
  await writeJSON('data/sessions.json', filtered);
}

// JWT相关操作
export function generateJWT(payload) {
  // 简化版JWT生成（生产环境使用jsonwebtoken库）
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const signature = btoa(`${header}.${body}.secret`);
  return `${header}.${body}.${signature}`;
}

export function verifyJWT(token) {
  try {
    const [header, body, signature] = token.split('.');
    const payload = JSON.parse(atob(body));
    return payload;
  } catch (error) {
    throw new Error('Invalid token');
  }
}

// 检查功能是否免费
export function isFreeFeature(feature) {
  const freeFeatures = ['today-hotspot', 'heatmap', 'top-cities'];
  return freeFeatures.includes(feature);
}
