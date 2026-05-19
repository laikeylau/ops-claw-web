FROM node:20-alpine

WORKDIR /app

# 复制源代码和配置文件
COPY package.json package-lock.json* ./
COPY tsconfig*.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY electron.vite.config.ts ./
COPY postcss.config.js ./
COPY tailwind.config.js ./

# 安装所有依赖（包括开发依赖）
RUN npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts

# 构建 Web 版本（包含服务器和前端）
RUN npm run build:web

# 清理开发依赖
RUN npm prune --omit=dev

# 创建数据目录
RUN mkdir -p /app/data

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "out/server/index.js"]
