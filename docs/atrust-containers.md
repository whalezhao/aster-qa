# aTrust VPN 容器约定

一个 aTrust 账号 / 门户对应一个独立容器。不要复用已有容器登录第二个账号，否则会顶掉原会话并污染路由。

## 命名与资源

```text
容器名：  atrust-<客户简称>
镜像：    hagb/docker-atrust:latest
volume：  /home/ai/.atrust-<客户简称> -> /root
网络：    bridge，不使用 host 网络
```

端口按客户编号分配，且只绑定本机：

```text
127.0.0.1:108<N> -> 1080   SOCKS5
127.0.0.1:888<N> -> 8888   HTTP 代理
127.0.0.1:590<N> -> 5901   VNC
127.0.0.1:608<N> -> 8080   noVNC（按需开启）
```

| 客户 | 容器 | 代理端口 | 环境代理地址（246 worker 为 host 网络） |
| --- | --- | --- | --- |
| 科伦 | `atrust-kelun` | 1080 / 8888 | `http://127.0.0.1:8888` |
| 国药司库 | `atrust-sinopharm` | 1081 / 8889 | `http://127.0.0.1:8889` |

## 设备绑定

aTrust 的设备绑定依赖稳定的 MAC。用 Docker 的 `--mac-address` 固定容器网卡，每个客户分配唯一 MAC：

```bash
docker run -d --name atrust-<客户> \
  --restart unless-stopped \
  --cap-add NET_ADMIN --device /dev/net/tun \
  --mac-address 02:53:4e:4f:00:01 \
  -p 127.0.0.1:108<N>:1080 \
  -p 127.0.0.1:888<N>:8888 \
  -p 127.0.0.1:590<N>:5901 \
  -e URLWIN=1 \
  -e PING_INTERVAL=200 \
  -v /home/ai/.atrust-<客户>:/root \
  hagb/docker-atrust:latest
```

- 不要设置镜像的 `FAKE_HWADDR`：实测在这个 aTrust 镜像里，`LD_PRELOAD=fake-hwaddr.so` 会让 aTrustAgent 反复被 Killed、客户端一直重启；固定 `--mac-address` 已经足够让设备绑定保持稳定。
- 每个客户用唯一 MAC；容器重建时保持这个值不变。
- 已经登录过的容器重新创建后，如果要求重新登录，重新登录一次即可重新绑定。

## 200 秒保活

镜像自带的 `PING_ADDR` / `PING_ADDR_URL` 在这类环境里不可靠（ICMP 被禁、HEAD 返回非 2xx）。使用一个共享网络命名空间的 sidecar 做 GET 保活：

```bash
docker run -d --name atrust-<客户>-keepalive \
  --restart unless-stopped \
  --network container:atrust-<客户> \
  --entrypoint sh \
  hagb/docker-atrust:latest \
  -c 'while true; do wget -q -O /dev/null --timeout=10 <内网可达地址> || true; sleep 200; done'
```

注意：

- sidecar 必须和 aTrust 容器同时创建、同时重建；aTrust 容器重建后 sidecar 的网络命名空间链接会失效，需要一起 `docker rm -f` 再启动。
- 保活地址选一个经 VPN 可达、GET 返回内容的地址，不要用只支持 HEAD 的接口。
- `PING_INTERVAL=200` 只是记录约定；实际保活由 sidecar 执行。

## 接入 Aster QA

在项目 → 环境的「浏览器代理」里填该客户的代理地址。平台只把代理设置传给 Chromium，不会设置进程级 `HTTP_PROXY`，因此模型请求、数据库连接不会走 VPN。

```text
环境：国药司库-默认
Base URL: http://10.128.18.201/OSPPortal/admin.htm
浏览器代理: http://127.0.0.1:8889
```

246 的 worker 是 host 网络，所以用 `127.0.0.1:<hostPort>`。如果以后 worker 改成 bridge，需要把代理发布到 worker 可达的地址，或让 worker 与代理容器共享网络。

## 验证

```bash
# 路由
docker exec atrust-<客户> ip route | grep <目标网段>

# 代理
curl -sS -I --max-time 10 -x http://127.0.0.1:888<N> http://<目标地址>

# 从 worker 验证（246 为 host 网络）
docker exec aster-qa-worker-1 curl -sS -I --max-time 10 \
  -x http://127.0.0.1:888<N> http://<目标地址>
```