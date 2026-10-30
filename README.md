# dsh-balance-view

把 DSH（DeepSeek Harness）里登录账号的 **DeepSeek 余额** 定时落成一个本地 JSON 文件，并开一个只读 HTTP 接口。
好处很简单：**脚本、别的插件、聊天机器人**不用登录 DSH，也能随时读到最新余额，而且读取本身不消耗 token。

## 它做什么

- 通过宿主自带的 `deepseekAccount` 服务取余额（充值钱包 + 赠金，口径与官方 `total_balance` 一致）
- 每 2 分钟刷新一次，写进 `$DSH_HOME/dsh-balance-view/cache.json`（默认 `~/.dsh/dsh-balance-view/cache.json`）
- 顺便提供一个只读接口：`GET /dsh-balance/balance.json`（加 `?refresh=1` 立刻重新取一次）

## 它不做什么

- 不自己拼 HTTP、不碰任何凭据：token 的注入、请求头、失效清理全部交给宿主的账号服务
- 不改设置、不写别的文件、不联网做别的事
- 没有 UI，一行界面都不加

## 安装

```bash
dsh plugin --profile <你的 profile> add dsh-balance-view
```

本地开发时直接链进来：

```bash
dsh plugin --profile <你的 profile> add link:<本目录绝对路径>
```

装完重启一次 DSH，就会看到 `~/.dsh/dsh-balance-view/cache.json` 开始更新。

## 缓存文件长什么样

```json
{
  "ok": true,
  "total": 7.76,
  "recharge": 7.76,
  "bonus": 0,
  "currency": "CNY",
  "wallets": [
    { "kind": "recharge", "currency": "CNY", "balance": 7.7637408 },
    { "kind": "bonus", "currency": "CNY", "balance": 0 }
  ],
  "checkedAt": "2026-10-30T04:06:25.186Z"
}
```

失败时 `ok` 为 `false`，`code` 会告诉你是哪一种：

| code | 意思 |
| --- | --- |
| `NO_ACCOUNT_SERVICE` | 当前宿主没有账号服务（老版本 DSH） |
| `NOT_LOGGED_IN` | 没登录 DeepSeek 账号，也没有账号凭据 |
| `NOT_READY` | 账号服务没就绪 |
| `NO_WALLET` | 账号没有任何余额钱包 |
| `ERROR` | 取数时抛异常，`error` 里是原因 |

## 怎么读

```bash
curl http://127.0.0.1:<DSH 端口>/dsh-balance/balance.json?refresh=1
```

或者直接读那个 cache.json。下面是个最简单的读取脚本（Node）：

```js
import { readFileSync } from 'node:fs'
const j = JSON.parse(readFileSync(process.env.HOME + '/.dsh/dsh-balance-view/cache.json', 'utf8'))
console.log(j.ok ? `余额 ${j.total} ${j.currency}` : `读不到：${j.error}`)
```

## 已知边界

- DSH 没开着就不会刷新，这时候缓存会变旧，`checkedAt` 就是判断依据
- 只读，不提供任何写入或充值能力
- 只在有 `deepseekAccount` 服务的宿主上有意义（账号登录用户）；纯 API key 用户请看宿主自己的余额卡片

## License

MIT
