


支付本地测试
stripe 测试
stripe login
stripe listen --forward-to localhost:3000/webhooks/stripe

applepay测试
ngrok config add-authtoken 36sKQzkLUmCWpxUU6pHDIe1XYXC_EZBYQevdNrmwu3MS68EL
ngrok http 3000

Render (部署 App) + MongoDB Atlas + Upstash(redis) 。


上线前准备
1. 设置订阅的webhook
2. 