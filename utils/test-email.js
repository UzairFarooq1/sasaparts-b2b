// Run with: npm run mail:test
// Verifies the SMTP credentials in .env and sends one test message to ADMIN_EMAIL.
require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
});

(async () => {
  console.log(`Connecting to ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} as ${process.env.SMTP_USER} ...`);
  await transporter.verify();
  console.log('✅ SMTP login accepted.');

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: process.env.ADMIN_EMAIL,
    subject: 'Techno Automotives B2B — email test',
    html: '<p>If you are reading this, order and low-stock notifications are working.</p>'
  });
  console.log(`✅ Test email sent to ${process.env.ADMIN_EMAIL} (${info.messageId})`);
})().catch((err) => {
  console.error('❌ Email test failed:', err.message);
  if (/Username and Password not accepted|BadCredentials/i.test(err.message)) {
    console.error('   Gmail rejects normal account passwords. Put a 16-character App Password');
    console.error('   from https://myaccount.google.com/apppasswords into SMTP_PASSWORD.');
  }
  process.exit(1);
});
