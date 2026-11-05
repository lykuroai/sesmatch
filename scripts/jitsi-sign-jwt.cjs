// Jitsi 開通確認用: アプリと同じ形式の参加 JWT を発行する（node scripts/jitsi-sign-jwt.cjs <secret> <room> <表示名>）
const jwt = require("jsonwebtoken");
const secret = process.argv[2], room = process.argv[3], name = process.argv[4];
const iat = Math.floor(Date.now()/1000);
console.log(jwt.sign({ aud:"jitsi", iss:"sesmatch", sub:"meet.lykuro.ai", room, iat, nbf: iat-10, exp: iat+7200, context:{ user:{ name, moderator:"true" } } }, secret, { algorithm:"HS256" }));
