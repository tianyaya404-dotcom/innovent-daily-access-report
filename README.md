# 信达准入日报云端版

这个目录提供一个最小可用的云端自动发送方案：

- 每天北京时间 08:00 由 GitHub Actions 触发
- 抓取公开 RSS/新闻搜索源中的信达生物、竞品、医保/挂网/价格治理信息
- 自动整理成中文纯文本日报
- 通过 Gmail 发到 `REPORT_TO`

## 目录

- [`package.json`](/Users/tian/Documents/xd产品学习计划/package.json)
- [`scripts/send-daily-report.mjs`](/Users/tian/Documents/xd产品学习计划/scripts/send-daily-report.mjs)
- [`.github/workflows/daily-report.yml`](/Users/tian/Documents/xd产品学习计划/.github/workflows/daily-report.yml)
- [`.env.example`](/Users/tian/Documents/xd产品学习计划/.env.example)

## 1. 创建 GitHub 仓库

把当前目录初始化成 Git 仓库并推到 GitHub。这个步骤做完以后，GitHub Actions 才能按计划跑。

## 2. 开启 Gmail 应用专用密码

推荐用 Gmail 的应用专用密码，而不是普通登录密码。

前提：

- Gmail 账号开启两步验证
- 在 Google 账号安全设置里创建一个 `App Password`

把得到的 16 位密码记下来，后面作为 `GMAIL_APP_PASSWORD`。

## 3. 配 GitHub Secrets

在仓库 `Settings > Secrets and variables > Actions` 里新增：

- `GMAIL_USER`: 发件 Gmail 地址
- `GMAIL_APP_PASSWORD`: Gmail 应用专用密码
- `REPORT_TO`: 收件地址，默认可填 `tianyaya404@gmail.com`
- `REPORT_TZ`: `Asia/Shanghai`

## 4. 确认定时

工作流文件里已经写好：

- `0 0 * * *`

GitHub Actions 的 `cron` 用 UTC 计时，所以这里对应北京时间每天 `08:00`。

## 5. 手动试跑

推到 GitHub 后，在仓库的 `Actions` 页选择 `Send Innovent Daily Report`，点击 `Run workflow`。

如果邮件正常到达，之后它会每天自动发。

## 6. 当前版本的边界

这是最小可用版，不是最终版。它的特点是：

- 优点：不依赖本机，不依赖打开 Codex，部署快
- 缺点：内容整理是规则驱动，不是人工深度研判

后续可以继续增强：

- 增加更多官方源和企业 IR 源
- 引入更细的产品/靶点/适应症映射
- 把省级挂网、医保、集采做成结构化表
- 接 OpenAI API 做更像人工日报的分析
