const express = require('express');
const cors = require('cors');

const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose();
const app = express();
app.use(cors());

const PORT = 3000;

const db = new sqlite3.Database(':memory:');

db.serialize(() => {
    // db.run("ALTER TABLE searches ADD COLUMN suffix TEXT");
    db.run("DROP TABLE IF EXISTS searches");
    db.run("CREATE TABLE IF NOT EXISTS searches (domain TEXT, suffix TEXT, timestamp DATETIME, result TEXT)");
});

// function storeSearch(domain,suffix) {
//     const timestamp = new Date().toISOString();
//     db.run("INSERT INTO searches (domain, suffix, timestamp) VALUES (?, ?, ?)", [domain, suffix, timestamp]);
// }

app.get('/recent-searches', (req, res) => {
    db.all("SELECT domain || '.' || suffix AS domain FROM searches ORDER BY timestamp DESC LIMIT 20", [], (err, rows) => {
        if (err) {
            res.status(500).send({ error: err.message });
            return;
        }
        res.send(rows.map(row => row.domain));
    });
});

app.get('/multi-check', async (req, res) => {
    const baseDomain = req.query.name; // 基础域名，如 "tt"
    const suffixes = ['com', 'net', 'ai', 'dev']; // 您想要查询的后缀列表
    const results = [];

    for (const suffix of suffixes) {
        const url = `https://whois.freeaiapi.xyz/?name=${encodeURIComponent(baseDomain)}&suffix=${encodeURIComponent(suffix)}`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            results.push({ domain: `${baseDomain}.${suffix}`, available: data.available });
        } catch (error) {
            console.error('API请求失败:', error);
            results.push({ domain: `${baseDomain}.${suffix}`, available: null, error: true });
        }
    }

    res.send(results);
});

app.use('/proxy', (req, res) => {
    const domain = req.query.name;
    const suffix = req.query.suffix;
    db.get("SELECT timestamp, result FROM searches WHERE domain = ? AND suffix = ? ORDER BY timestamp DESC LIMIT 1", [domain, suffix], (err, row) => {
        if (err) {
            return res.status(500).send({ error: err.message });
        }

        const now = new Date();
        if (row && new Date(row.timestamp) > new Date(now.getTime() - 24*60*60*1000)) {
            // 如果24小时内已经查询过，返回缓存的结果
            const cachedResult = JSON.parse(row.result); // 假设结果是以JSON字符串形式存储的
            return res.send(cachedResult);
        } 
    });

    // storeSearch(domain,suffix);

    const url = `https://whois.freeaiapi.xyz/?name=${encodeURIComponent(domain)}&suffix=${encodeURIComponent(suffix)}`;

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data.status === 'ok') {
                const result = JSON.stringify(data);
                const timestamp = new Date().toISOString();
                db.run("INSERT INTO searches (domain, suffix, timestamp, result) VALUES (?, ?, ?, ?)", [domain, suffix, timestamp, result], (err) => {
                    if (err) {
                        console.error('存储搜索记录时出错:', err);
                        if (!res.headersSent) {
                            res.status(500).send("内部服务器错误");
                        }                        return; // 关键：阻止后续代码执行
                    }
                   // 确保响应还没有被发送
                    if (!res.headersSent) {
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.send(data);
                    }
                });
            } else {
               // 确保响应还没有被发送
    if (!res.headersSent) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(data);
    }
            }
        })
        .catch(error => {
            console.error('API请求失败:', error);
            res.status(500).send({ error: error.message }); // 处理fetch失败的情况
        });
});

app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
});
