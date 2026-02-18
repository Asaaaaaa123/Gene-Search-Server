# 生产环境部署指南 (Production Deployment Guide)

## 快速开始

### 1. 环境变量配置

创建 `.env` 文件（或在使用 Coolify 时在环境变量中设置）：

```bash
# 后端 MongoDB 连接（可选，但推荐）
MONGODB_URI=mongodb://username:password@host:27017/gene_search_db
# 或 MongoDB Atlas
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/gene_search_db

# 认证令牌（可选，用于 API 保护）
VALID_TOKENS=your_token_here,another_token_here

# 前端 API URL（必需！）
# 这必须是后端服务的公共可访问 URL
# 对于 Coolify 部署，使用 Coolify 提供的域名
NEXT_PUBLIC_API_URL=https://your-backend-service.your-coolify-domain.com
```

### 2. 部署到 Coolify

#### 方法一：使用 Docker Compose（推荐）

1. **在 Coolify 中创建新应用**
   - 选择 "Docker Compose" 作为部署方式
   - 上传 `docker-compose.yml` 文件

2. **设置环境变量**
   在 Coolify 的环境变量部分设置：
   ```
   NEXT_PUBLIC_API_URL=https://your-backend-service.your-coolify-domain.com
   MONGODB_URI=your_mongodb_connection_string (可选)
   VALID_TOKENS=token1,token2 (可选)
   ```

3. **重要提示**
   - `NEXT_PUBLIC_API_URL` 必须在构建时设置，因为它会被嵌入到前端代码中
   - 确保后端服务已经部署并可以访问
   - 前端构建时会使用这个 URL

#### 方法二：分别部署前后端

1. **部署后端**
   - 使用 `Dockerfile.backend`
   - 设置环境变量：`MONGODB_URI`, `VALID_TOKENS`
   - 确保数据文件在 `/app/data` 目录

2. **部署前端**
   - 使用 `Dockerfile.frontend`
   - **构建参数**：`NEXT_PUBLIC_API_URL` 必须设置为后端的公共 URL
   - 例如：`docker build --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t frontend .`

### 3. 本地生产环境测试

```bash
# 使用生产配置
docker-compose -f docker-compose.prod.yml up -d

# 查看日志
docker-compose -f docker-compose.prod.yml logs -f

# 停止服务
docker-compose -f docker-compose.prod.yml down
```

## 配置说明

### 后端配置

- **Workers**: 默认 2 个 worker，可通过 `WORKERS` 环境变量调整（推荐：CPU 核心数 × 2）
- **端口**: 8000
- **健康检查**: 每 30 秒检查 `/docs` 端点
- **资源限制**: 
  - CPU: 0.5-2 核心
  - 内存: 512MB-2GB

### 前端配置

- **端口**: 3000
- **健康检查**: 每 30 秒检查根路径
- **资源限制**:
  - CPU: 0.25-1 核心
  - 内存: 256MB-1GB

## 常见问题

### Q: 前端无法连接到后端

**原因**: `NEXT_PUBLIC_API_URL` 未正确设置或设置为内部 Docker 网络地址

**解决**:
1. 确保 `NEXT_PUBLIC_API_URL` 设置为后端的**公共可访问 URL**
2. 浏览器无法访问 Docker 内部网络地址（如 `http://backend:8000`）
3. 必须使用完整的公共 URL（如 `https://api.example.com`）

### Q: 如何查看服务状态？

```bash
# 查看所有服务状态
docker-compose ps

# 查看健康检查状态
docker-compose ps | grep -E "healthy|unhealthy"

# 查看日志
docker-compose logs backend
docker-compose logs frontend
```

### Q: 如何更新部署？

```bash
# 重新构建并启动
docker-compose up -d --build

# 仅重启服务（不重新构建）
docker-compose restart
```

### Q: 数据文件在哪里？

数据文件（`.xlsx` 文件）位于 `./backend/data/` 目录，通过 volume 挂载到容器中。

**重要**: 确保这些文件在部署时存在，或者将它们包含在 Docker 镜像中。

### Q: 如何调整资源限制？

编辑 `docker-compose.yml` 中的 `deploy.resources` 部分，或使用 `docker-compose.prod.yml` 获取更高的资源限制。

## 安全建议

1. **CORS 配置**: 生产环境中，考虑限制 CORS 允许的源
2. **认证令牌**: 使用 `VALID_TOKENS` 保护 API
3. **MongoDB**: 使用强密码和网络访问限制
4. **HTTPS**: 使用反向代理（如 Nginx）配置 HTTPS
5. **数据卷**: 数据文件挂载为只读（`:ro`）以提高安全性

## 性能优化

1. **后端 Workers**: 根据 CPU 核心数调整 `WORKERS` 环境变量
2. **资源限制**: 根据实际负载调整 CPU 和内存限制
3. **缓存**: 考虑添加 Redis 缓存层
4. **CDN**: 前端静态资源可以使用 CDN 加速

## 监控和日志

- 日志文件限制为每个服务 10MB，最多保留 3 个文件
- 使用 `docker-compose logs` 查看实时日志
- 考虑集成日志聚合服务（如 ELK Stack）

## 故障排除

### 后端无法启动

1. 检查 MongoDB 连接（如果使用）
2. 检查数据文件是否存在
3. 查看日志：`docker-compose logs backend`

### 前端构建失败

1. 确保 `NEXT_PUBLIC_API_URL` 已设置
2. 检查 Node.js 版本兼容性
3. 查看构建日志

### 健康检查失败

1. 检查服务是否正在运行
2. 验证端口是否正确暴露
3. 检查防火墙设置





