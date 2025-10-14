# Gene Search Server

## 快速启动

### 1. 启动后端服务器

**方法一：使用启动脚本（推荐）**
```bash
# 在项目根目录运行
python start_backend.py
```

**方法二：直接启动**
```bash
cd backend
python -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

**方法三：使用 server.py**
```bash
cd backend
python server.py
```

### 2. 启动前端

```bash
cd genegen
npm run dev
```

## 故障排除

### API 连接问题

如果遇到 "Failed to fetch" 错误：

1. **检查后端是否运行**
   - 确保后端服务器在端口 8000 上运行
   - 访问 http://localhost:8000/docs 验证

2. **检查端口占用**
   ```bash
   # Windows
   netstat -ano | findstr :8000
   
   # Linux/Mac
   lsof -i :8000
   ```

3. **停止占用端口的服务**
   ```bash
   # Windows (替换 PID 为实际进程ID)
   taskkill /PID <PID> /F
   
   # Linux/Mac
   kill -9 <PID>
   ```

### MongoDB 连接问题

后端服务器现在可以启动，即使没有 MongoDB 连接：
- 如果 MongoDB 可用，将使用数据库功能
- 如果 MongoDB 不可用，服务器仍会启动，但某些功能可能受限

### 环境变量配置

创建 `.env.local` 文件（前端）：
```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## 服务器状态

- 🟢 **绿色**：API 已连接
- 🔴 **红色**：API 连接断开
- 🟡 **黄色**：正在检查连接

## 测试连接

1. 使用页面上的 "Test Connection" 按钮
2. 检查 API 状态指示器
3. 访问 http://localhost:8000/docs 查看 API 文档

## 常见问题

**Q: 端口 8000 被占用怎么办？**
A: 停止占用端口的服务，或修改前端配置使用其他端口

**Q: MongoDB 连接失败怎么办？**
A: 服务器仍会启动，但某些功能可能受限

**Q: 前端显示 "Failed to fetch" 怎么办？**
A: 检查后端服务器是否在运行，端口是否正确
