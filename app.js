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
app.use(express.static(path.join(__dirname, 'public')));
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
const adminCode = process.env.ADMIN_CODE || 'adminx';
const userCode = process.env.USER_CODE || 'xxrk';

/**
 * @method 获取客户端IP地址
 * @param {string} req 传入请求HttpRequest
 * 客户请求的IP地址存在于request对象当中
 * express框架可以直接通过 req.ip 获取
 */
function getClientIp(req) {
    return req.headers['x-forwarded-for'] ||
        req.ip ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress ||
        '';
}

// 上述代码是直接获取的IPV4地址，如果获取到的是IPV6，则通过字符串的截取来转换为IPV4地址。
function ipv6ToV4(ip) {
    if(ip.split(',').length>0){
        ip = ip.split(',')[0]
    }
    ip = ip.substr(ip.lastIndexOf(':')+1,ip.length);
    return ip
}

// 修改的打卡按钮路由
app.post('/checkin', async (req, res) => {
    const { name, code } = req.body;
    const ipAddress = getClientIp(req); // Use getClientIp function to get IP address

    try {
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

        // 查询验证码是否存在且有效，以及 IP 是否存在于数据库中
        let connectionForCodeAndIP = await createConnection();

        try {
            const [yzmData] = await connectionForCodeAndIP.query(`
                SELECT Code, ExpirationTime
                FROM yzm
                WHERE Code = ?;
            `, [code]);

            // Check if the verification code exists
            if (yzmData.length === 0) {
                return res.status(403).send('验证码无效！');
            }

            // Check if the verification code has expired
            const expirationTime = new Date(yzmData[0].ExpirationTime);
            if (expirationTime <= new Date()) {
                return res.status(403).send('验证码已过期！');
            }

            // 校验验证码是否正确
            if (code !== yzmData[0].Code) {
                return res.status(403).send('验证码不正确！');
            }

            // 查询 IP 地址是否已签到
            const [ipData] = await connectionForCodeAndIP.query(`
                SELECT id, created_at
                FROM ip_addresses
                WHERE ip_address = ? AND DATE(created_at) = CURDATE();
            `, [ipAddress]);

            if (ipData.length > 0) {
                return res.status(403).send('您的IP今天已签到，请勿重复签到！');
            }

        } catch (error) {
            console.error('查询验证码或IP地址时出错：', error);
            return res.status(500).send('查询验证码或IP地址时出错\n内部服务器错误');
        } finally {
            connectionForCodeAndIP.end();
        }

        // 查询员工是否在当天已签到
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let connectionForCheckin = await createConnection(); // 使用新的连接

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
            // 将checkInTime增加8个小时
            // checkInTime.setHours(checkInTime.getHours() + 8);

            // 检查连接是否仍然是打开状态
            if (connectionForCheckin.state === 'disconnected') {
                throw new Error('数据库连接已关闭');
            }

            await connectionForCheckin.execute('INSERT INTO employees (name, checkInTime) VALUES (?, ?)', [name, checkInTime]);

            // 将 IP 地址插入数据库，并将 created_at 转换为 'Asia/Shanghai' 时区
            await connectionForCheckin.execute('INSERT INTO ip_addresses (ip_address, created_at) VALUES (?, CONVERT_TZ(NOW(), "+00:00", "+08:00"))', [ipAddress]);

            return res.send('打卡成功！');
        } catch (error) {
            console.error('处理打卡请求时出错：', error);
            return res.status(500).send('内部服务器错误');
        } finally {
            // 在 finally 中添加对连接状态的检查
            if (connectionForCheckin && connectionForCheckin.state !== 'disconnected') {
                connectionForCheckin.end();
            }
        }
    } catch (error) {
        console.error('处理打卡请求时出错：', error);
        return res.status(500).send('内部服务器错误');
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

        // 设置文件名
        const dateStr = today.toISOString().split('T')[0];
        const excelFileName = `checkin_data_${dateStr}.xlsx`;

        // 设置下载头
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${excelFileName}"`);

        // 将工作簿内容发送到响应
        workbook.xlsx.write(res)
            .then(() => {
                // 结束响应
                res.end();
            })
            .catch((error) => {
                console.error('生成Excel文件时出错：', error);
                return res.status(500).send('内部服务器错误');
            });
    } catch (error) {
        console.error('查询当天打卡记录时出错：', error);
        return res.status(500).send('内部服务器错误');
    } finally {
        connection.end();
    }
});

// 后端路由
app.get('/top-employees', async (req, res) => {
    const connection = await createConnection();

    try {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);

        const [rows] = await connection.query(`
            SELECT name, COUNT(*) as count
            FROM employees
            WHERE checkInTime >= ?
            GROUP BY name
            ORDER BY count DESC
            LIMIT 10;
        `, [startOfMonth]);

        // 将前10名员工信息发送给前端
        res.json(rows);
    } catch (error) {
        console.error('查询前10名员工时出错：', error);
        return res.status(500).send('内部服务器错误');
    } finally {
        connection.end();
    }
});

// 导出全部签到数据到Excel
app.get('/export-all', async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('AllCheckInData');

    // 添加表头
    worksheet.addRow(['Name', 'Check-in Time']);

    // 查询所有打卡记录
    const connection = await createConnection();

    try {
        const [allEmployees] = await connection.query(`
            SELECT name, checkInTime
            FROM employees
        `);

        // 添加所有打卡记录到Excel
        allEmployees.forEach((employee) => {
            worksheet.addRow([employee.name, employee.checkInTime]);
        });

        // 设置文件名
        const excelFileName = 'all_checkin_data.xlsx';

        // 设置下载头
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${excelFileName}"`);

        // 将工作簿内容发送到响应
        workbook.xlsx.write(res)
            .then(() => {
                // 结束响应
                res.end();
            })
            .catch((error) => {
                console.error('生成Excel文件时出错：', error);
                return res.status(500).send('内部服务器错误');
            });
    } catch (error) {
        console.error('查询所有打卡记录时出错：', error);
        return res.status(500).send('内部服务器错误');
    } finally {
        connection.end();
    }
});

// 导出每天签到情况到Excel
app.get('/export-daily', async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('DailyCheckInData');

    // 查询所有员工
    const connection = await createConnection();

    try {
        const [employees] = await connection.query(`
            SELECT DISTINCT name
            FROM employees
        `);

        // 添加表头
        worksheet.addRow(['Name', ...Array.from({ length: 31 }, (_, i) => i + 1)]);

        // 查询每天的签到情况
        for (const employee of employees) {
            const [checkInData] = await connection.query(`
                SELECT DAY(checkInTime) as day
                FROM employees
                WHERE name = ?
            `, [employee.name]);

            const row = Array(31).fill('缺卡'); // 默认为缺卡

            for (const record of checkInData) {
                const day = record.day;
                row[day - 1] = '签到';
            }

            worksheet.addRow([employee.name, ...row]);
        }

        // 生成Excel文件
        const excelFileName = 'daily_checkin_data.xlsx';
        await workbook.xlsx.writeFile(excelFileName);

        // 设置下载头
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${excelFileName}"`);

        // 将工作簿内容发送到响应
        workbook.xlsx.write(res)
            .then(() => {
                // 结束响应
                res.end();
            })
            .catch((error) => {
                console.error('生成Excel文件时出错：', error);
                return res.status(500).send('内部服务器错误');
            });
    } catch (error) {
        console.error('查询员工时出错：', error);
        return res.status(500).send('内部服务器错误');
    } finally {
        connection.end();
    }
});

// 新增一个路由用于生成验证码
app.post('/generate-code', async (req, res) => {
    const { code } = req.body;

    // 检查是否是管理员 code
    if (code == 'adminx') {
        return res.status(403).send('此为管理员页面，请输入你想要设置新的校验码！');
    }

    // 检查是否已存在相同的验证码
    const connection = await createConnection();

    try {
        const [existingCode] = await connection.query(`
            SELECT Code
            FROM yzm
            WHERE Code = ?;
        `, [code]);

        if (existingCode.length > 0) {
            return res.status(400).send('相同的验证码已存在！');
        }

        // 获取当前日期
        const currentDate = new Date().toISOString().split('T')[0];

        // 插入验证码记录
        const expirationTime = new Date();
        expirationTime.setDate(expirationTime.getDate());// + 1
        expirationTime.setHours(23, 59, 59, 999);

        await connection.execute('INSERT INTO yzm (Code, Date, IsUsed, ExpirationTime) VALUES (?, ?, DEFAULT, ?)', [code, currentDate, expirationTime]);

        return res.send('验证码已生成并插入数据库！');
    } catch (error) {
        console.error('生成验证码时出错：', error);
        return res.status(500).send('内部服务器错误');
    } finally {
        connection.end();
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unexpected error:', err);
    res.status(500).send('Internal Server Error');
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});