# CodexTest Webpage

这是一个单人使用的私人日记网页。

## 功能

- 日记内容在浏览器里用密码加密后保存到服务器。
- 不同设备访问同一个服务器地址，输入同一个日记密码即可读取最新内容。
- 支持新增、编辑、删除、清空日记。
- 支持按关键词、日期、分类筛选。
- 每篇日记可添加分类、多张图片和多个链接。
- 打开日记后会每 10 秒从服务器检查一次最新内容。

## Windows 本地运行

```powershell
powershell -ExecutionPolicy Bypass -File .\server.ps1 -HostName 0.0.0.0 -Port 8000
```

## Python 环境运行

```powershell
python server.py --host 0.0.0.0 --port 8000
```

电脑访问：

```text
http://localhost:8000
```

同一 Wi-Fi 下手机访问：

```text
http://电脑的局域网 IP:8000
```

手机和电脑需要在同一个网络下。第一次使用时设置日记密码，之后所有设备输入同一个密码。

## 公网部署

如果你希望在别的城市也能访问，必须把这个项目部署到公网服务器或支持持久磁盘的部署平台。

推荐使用 Render：

1. 把这个项目推送到 GitHub 仓库。
2. 登录 Render，选择 New > Blueprint。
3. 连接这个 GitHub 仓库。
4. Render 会读取 `render.yaml` 创建 Web Service 和持久磁盘。
5. 部署完成后，打开 Render 分配的 `https://...onrender.com` 地址。

部署要求：

- 启动命令：`python server.py`
- 平台需要提供 HTTPS 网址。
- 平台需要有持久化磁盘，否则重启或重新部署后 `data/diary-vault.json` 可能丢失。
- 如果平台提供 `PORT` 环境变量，服务器会自动读取。
- 如果平台的持久磁盘挂载在其他目录，设置环境变量 `DIARY_DATA_DIR` 指向那个目录。

部署后访问平台给你的 HTTPS 网址即可，例如：

```text
https://your-diary.example.com
```

不同城市、不同设备打开这个网址，输入同一个日记密码，就能读取服务器上的最新内容。

## 数据位置

服务器会把加密后的日记保存到：

```text
data/diary-vault.json
```

这个文件里是加密后的内容，不是明文日记。请保存好日记密码，忘记后无法恢复。
