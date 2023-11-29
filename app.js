const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const session = require('express-session');
const ExcelJS = require('exceljs');
const path = require('path');

const app = express();

// 连接 MySQL 数据库
const createConnection = async () => {
    try {
        const connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST || 'tpe0.clusters.zeabur.com',
            port: process.env.MYSQL_PORT || 30872,
            user: process.env.MYSQL_USER || 'root',
            password: process.env.MYSQL_PASSWORD || 'y498g30fkoN6',
            database: process.env.MYSQL_DATABASE || 'xxrk',
        });
        return connection;
    } catch (error) {
        console.error('MySQL Connection Error:', error);
        throw error;
    }
};

// 中间件配置
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: 'xxrk',
    resave: true,
    saveUninitialized: true,
}));

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// 管理员验证码
const adminCode = process.env.ADMIN_CODE || 'admin-xxrk';
const userCode = process.env.ADMIN_CODE || 'xxrk';

// 打卡按钮路由
app.post('/checkin', async (req, res) => {
    const { name, code } = req.body;
    const ipAddress = req.ip;  // 使用 req.ip 获取真实 IP 地址

    // 检查管理员验证码
    if (code === adminCode) {
        // 查询当月打卡次数最多的前10名员工
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        const connection = await createConnection();

        try {
            const [rows] = await connection.query(`
                SELECT name, COUNT(*) as count
                FROM employees
                WHERE checkInTime >= ?
                GROUP BY name
                ORDER BY count DESC
                LIMIT 10;
            `, [startOfMonth]);

            return res.send('欢迎！管理员页面');
        } catch (error) {
            console.error('查询前10名员工时出错：', error);
            return res.status(500).send('内部服务器错误');
        } finally {
            connection.end();
        }
    }

    // 查询验证码是否存在且有效
    const connection = await createConnection();

    try {
        const [yzmData] = await connection.query(`
            SELECT Code, ExpirationTime
            FROM yzm
            WHERE Code = ? AND ExpirationTime > NOW();
        `, [code]);

        if (yzmData.length === 0) {
            return res.status(403).send('验证码无效！');
        }

        if (yzmData[0].Expiration <= new Date()) {
            return res.status(403).send('验证码已过期！');
        }

        // 校验验证码是否正确
        if (code !== yzmData[0].Code) {
            return res.status(403).send('验证码不正确！');
        }
    } catch (error) {
        console.error('查询验证码时出错：', error);
        return res.status(500).send('内部服务器错误');
    } finally {
        connection.end();
    }

    // ip相同拒绝打卡请求
    if (req.session[ipAddress]) {
        return res.status(403).send('您的IP今天已签到，请勿重复签到！');
    }

    // 查询员工是否在当天已签到
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const connectionForCheckin = await createConnection();  // 使用新的连接

    try {
        const [existingCheckin] = await connectionForCheckin.query(`
            SELECT COUNT(*) as count
            FROM employees
            WHERE name = ? AND DATE(checkInTime) = ?
        `, [name, today]);

        if (existingCheckin[0].count > 0) {
            return res.status(403).send('您今天已签到，请勿重复签到！');
        }

        // 保存打卡记录
        const checkInTime = new Date();
        await connectionForCheckin.execute('INSERT INTO employees (name, checkInTime) VALUES (?, ?)', [name, checkInTime]);

        // 保存IP地址，限制一天内只能打卡一次
        req.session[ipAddress] = true;

        return res.send('打卡成功！');
    } catch (error) {
        console.error('处理打卡请求时出错：', error);
        return res.status(500).send('内部服务器错误');
    } finally {
        connectionForCheckin.end();
    }
});

// 导出当天打卡情况到Excel
app.get('/export', async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('CheckInData');

    // 添加表头
    worksheet.addRow(['Name', 'Check-in Time']);

    // 查询当天打卡记录
    const connection = await createConnection();

    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [employees] = await connection.query(`
            SELECT name, checkInTime
            FROM employees
            WHERE DATE(checkInTime) = ?
        `, [today]);

        // 添加打卡记录到Excel
        employees.forEach((employee) => {
            worksheet.addRow([employee.name, employee.checkInTime]);
        });

        // 生成Excel文件
        const dateStr = today.toISOString().split('T')[0];
        const excelFilePath = `checkin_data_${dateStr}.xlsx`;
        await workbook.xlsx.writeFile(excelFilePath);

        // 返回生成的Excel文件
        res.download(excelFilePath, (err) => {
            if (err) {
                console.error(err);
                return res.status(500).send('内部服务器错误');
            }

            // 删除生成的Excel文件
            require('fs').unlink(excelFilePath, (err) => {
                if (err) {
                    console.error(err);
                }
            });
        });
    } catch (error) {
        console.error('查询当天打卡记录时出错：', error);
        return res.status(500).send('内部服务器错误');
    } finally {
        connection.end();
    }
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});