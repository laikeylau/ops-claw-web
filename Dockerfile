FROM node:20-alpine

WORKDIR /app

# 安装生产依赖
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev --ignore-scripts

# 复制构建产物
COPY out/ ./out/

# 创建数据目录
RUN mkdir -p /app/data

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "out/server/index.js"]
