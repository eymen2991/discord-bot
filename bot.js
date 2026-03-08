const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ActivityType, Collection, REST, Routes, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, Partials, AttachmentBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, getVoiceConnection, NoSubscriberBehavior } = require('@discordjs/voice');
const canvafy = require('canvafy');
const ytDlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Nexora Bot 7/24 Aktif!');
});

app.listen(port, () => {
    console.log(`Web sunucusu ${port} portunda çalışıyor.`);
});

dotenv.config();

const TOKEN = process.env.TOKEN;
const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID;

// Test sonuçlarına göre senin anahtarın için çalışan modeller ve sürümleri:
const MODELS_TO_TRY = [
    { name: "gemini-1.5-flash", version: "v1" },
    { name: "gemini-2.0-flash", version: "v1" },
    { name: "gemini-flash-latest", version: "v1beta" }
];
let lastWorkingModelIndex = 0;
const aiCooldowns = new Map(); // Yapay zeka için hız sınırlayıcı
const blackjackGames = new Map(); // Blackjack oyun takibi
const minesGames = new Map(); // Mayın tarlası oyun takibi
const xpCooldowns = new Map(); // Level sistemi için cooldown

// ---------------- BLACKJACK YARDIMCILAR ----------------
function createDeck() {
    const suits = ['♠️', '♥️', '♦️', '♣️'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let deck = [];
    for (const suit of suits) {
        for (const value of values) {
            deck.push({ suit, value });
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

function getScore(hand) {
    let score = 0;
    let aces = 0;
    for (const card of hand) {
        if (card.value === 'A') {
            aces++;
            score += 11;
        } else if (['J', 'Q', 'K'].includes(card.value)) {
            score += 10;
        } else {
            score += parseInt(card.value);
        }
    }
    while (score > 21 && aces > 0) {
        score -= 10;
        aces--;
    }
    return score;
}

const player = createAudioPlayer({
    behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
    },
});

const slotCooldowns = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const prefixes = ["nex ", "n!", "x!"];


// ---------------- VERİ YÖNETİMİ ----------------

const loadJSON = (filename, defaultData = {}) => {
    const filePath = path.join(__dirname, filename);
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 4));
        return defaultData;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath));
    } catch (e) {
        console.error(`Error reading ${filename}:`, e);
        return defaultData;
    }
};

const saveJSON = (filename, data) => {
    const filePath = path.join(__dirname, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
};

// ---------------- EKONOMİ ----------------

const para_yukle = () => loadJSON('para.json');
const para_kaydet = (data) => saveJSON('para.json', data);

const hesap_olustur = (user_id) => {
    user_id = user_id.toString();
    let data = para_yukle();
    if (!data[user_id] && data[user_id] !== 0) {
        data[user_id] = 0;
        para_kaydet(data);
    }
};

// ---------------- MARKET VE ŞANS SİSTEMİ (YENİ) ----------------

const DATA_FILE = path.join(__dirname, 'data.json');

function p_loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        const initialData = {
            users: {},
            market: { elmas: 100000, yakut: 50000, altin: 20000, gumus: 10000, bronz: 2000, tuvalet_kagidi: 500 },
            marketChanges: { elmas: "0%", yakut: "0%", altin: "0%", gumus: "0%", bronz: "0%", tuvalet_kagidi: "0%" },
            lastMarketUpdate: 0
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 4));
        return initialData;
    }
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE));
    } catch (e) {
        return { users: {}, market: {}, marketChanges: {}, lastMarketUpdate: 0 };
    }
}

function p_saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
}

function p_checkUser(data, userId) {
    if (!data.users[userId]) {
        data.users[userId] = {
            coins: 1000,
            items: { elmas: 0, yakut: 0, altin: 0, gumus: 0, bronz: 0, tuvalet_kagidi: 0 },
            dailyLuck: 0,
            lastLuckUse: 0,
            tahminCount: 0,
            lastTahminReset: 0
        };
    }
    // Eğer kullanıcı verisinde yeni alanlar yoksa ekle (Geriye dönük uyumluluk)
    if (data.users[userId].tahminCount === undefined) data.users[userId].tahminCount = 0;
    if (data.users[userId].lastTahminReset === undefined) data.users[userId].lastTahminReset = 0;
}

function p_updateMarket(data) {
    const now = Date.now();
    if (now - data.lastMarketUpdate >= 3600000) {
        for (const item in data.market) {
            const isIncrease = Math.random() > 0.5;
            const percentage = (Math.random() * (15 - 5) + 5) / 100;
            const changeFactor = isIncrease ? 1 + percentage : 1 - percentage;
            const oldPrice = data.market[item];
            let newPrice = Math.floor(oldPrice * changeFactor);
            if (newPrice < 100) newPrice = 100;
            const actualChangePercent = ((newPrice - oldPrice) / oldPrice * 100).toFixed(1);
            data.market[item] = newPrice;
            data.marketChanges[item] = (actualChangePercent >= 0 ? "+" : "") + actualChangePercent + "%";
        }
        data.lastMarketUpdate = now;
        p_saveData(data);
    }
}

// ---------------- XP SİSTEMİ ----------------

const xp_yukle = () => loadJSON('xp.json');
const xp_kaydet = (data) => saveJSON('xp.json', data);

// ---------------- MÜZİK DEĞİŞKENLERİ ----------------

let musicQueue = [];
let isLooping = false; // Döngü durumu
let currentResource = null; // Ses seviyesi kontrolü için

async function playNext(message) {
    if (musicQueue.length === 0) return;

    const { query, message: originalMessage } = musicQueue[0];

    try {
        const info = await ytDlp(query, {
            dumpJson: true,
            defaultSearch: 'ytsearch1:',
            format: 'bestaudio/best',
            noWarnings: true,
            noCallHome: true,
            noCheckCertificate: true
        });

        const video = info.entries ? info.entries[0] : info;
        if (!video || !video.url) {
            originalMessage.channel.send(`❌ **${query}** bulunamadı, sıradakine geçiliyor...`);
            musicQueue.shift();
            return playNext(originalMessage);
        }

        const ffmpegProcess = spawn(ffmpegPath, [
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-i', video.url,
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
            'pipe:1'
        ], { stdio: ['ignore', 'pipe', 'ignore'] });

        const resource = createAudioResource(ffmpegProcess.stdout, {
            inputType: 'raw',
            inlineVolume: true
        });

        resource.volume.setVolume(0.5);
        currentResource = resource; // Ses ayarı için sakla
        player.play(resource);

        const connection = getVoiceConnection(originalMessage.guild.id);
        if (connection) connection.subscribe(player);

        const embed = new EmbedBuilder()
            .setTitle("🎶 Şimdi Çalıyor")
            .setDescription(`**[${video.title}](${video.webpage_url})**`)
            .setThumbnail(video.thumbnail)
            .addFields(
                { name: "⏳ Süre", value: `\`${video.duration_string || "Bilinmiyor"}\``, inline: true },
                { name: "👤 İsteyen", value: `${originalMessage.author}`, inline: true }
            )
            .setColor("#FF0000");

        originalMessage.channel.send({ embeds: [embed] });
    } catch (error) {
        console.error("[KUYRUK HATASI]:", error);
        originalMessage.channel.send(`❌ **${query}** çalınırken hata oluştu.`);
        musicQueue.shift();
        playNext(originalMessage);
    }
}

// Player Idle olduğunda sıradakine geç
player.on(AudioPlayerStatus.Idle, () => {
    if (musicQueue.length > 0) {
        if (!isLooping) {
            musicQueue.shift();
        }
        if (musicQueue.length > 0) {
            playNext(musicQueue[0].message);
        }
    }
});

// ---------------- BOT HAZIR ----------------

// ---------------- SLASH KOMUT TANIMLARI ----------------
const slashCommands = [
    // Ekonomi
    { name: 'bakiye', description: 'Bakiyeni gösterir.' },
    { name: 'gunluk', description: 'Günlük ödülünü alırsın.' },
    {
        name: 'slot',
        description: 'Slot oynarsın.',
        options: [{ name: 'miktar', description: 'Bahis miktarı', type: 4, required: true }]
    },
    { name: 'zenginler', description: 'En zengin kullanıcıları listeler.' },
    {
        name: 'paraat',
        description: 'Başka bir kullanıcıya para gönderirsin.',
        options: [
            { name: 'kullanıcı', description: 'Para gönderilecek kişi', type: 6, required: true },
            { name: 'miktar', description: 'Gönderilecek miktar', type: 4, required: true }
        ]
    },
    { name: 'market', description: 'Market fiyatlarını gösterir.' },
    {
        name: 'satınal',
        description: 'Marketten ürün alırsın.',
        options: [
            { name: 'ürün', description: 'Alınacak ürün adı', type: 3, required: true },
            { name: 'miktar', description: 'Alınacak miktar', type: 4, required: false }
        ]
    },
    {
        name: 'sat',
        description: 'Marketten ürün satarsın.',
        options: [
            { name: 'ürün', description: 'Satılacak ürün adı', type: 3, required: true },
            { name: 'miktar', description: 'Satılacak miktar', type: 4, required: false }
        ]
    },
    { name: 'sans', description: 'Günlük şansını ölçer.' },
    {
        name: 'tahmin',
        description: '1-10 arası sayı tahmin edersin.',
        options: [{ name: 'sayı', description: 'Tahminin (1-10)', type: 4, required: true }]
    },
    { name: 'envanter', description: 'Envanterini gösterir.' },

    // Seviye
    {
        name: 'level',
        description: 'Seviye ve XP bilgisini gösterir.',
        options: [{ name: 'kullanıcı', description: 'Bakılacak kişi', type: 6, required: false }]
    },

    // Müzik
    {
        name: 'çal',
        description: 'Müzik çalar.',
        options: [{ name: 'şarkı', description: 'Şarkı adı veya URL', type: 3, required: true }]
    },
    { name: 'geç', description: 'Şarkıyı geçer.' },
    { name: 'dur', description: 'Müziği durdurur.' },
    { name: 'devam', description: 'Müziği devam ettirir.' },
    { name: 'çık', description: 'Ses kanalından çıkar.' },
    { name: 'sıra', description: 'Şarkı kuyruğunu gösterir.' },
    {
        name: 'ses',
        description: 'Ses seviyesini ayarlar.',
        options: [{ name: 'seviye', description: '0-100 arası', type: 4, required: true }]
    },
    { name: 'döngü', description: 'Şarkıyı tekrarlar.' },

    // Eğlence
    { name: 'ego', description: 'Günün en egolusunu seçer.' },
    {
        name: 'roast',
        description: 'Birine laf sokar.',
        options: [{ name: 'kullanıcı', description: 'Laf sokulacak kişi', type: 6, required: true }]
    },
    {
        name: 'tkm',
        description: 'Taş-Kağıt-Makas oynarsın.',
        options: [{
            name: 'seçim',
            description: 'Taş, Kağıt veya Makas',
            type: 3,
            required: true,
            choices: [
                { name: 'Taş', value: 'taş' },
                { name: 'Kağıt', value: 'kağıt' },
                { name: 'Makas', value: 'makas' }
            ]
        }]
    },
    { name: 'üye', description: 'Sunucu istatistiklerini gösterir.' },
    {
        name: 'sarıl',
        description: 'Birine sarılır.',
        options: [{ name: 'kullanıcı', description: 'Sarılacak kişi', type: 6, required: false }]
    },
    {
        name: 'op',
        description: 'Birini öper.',
        options: [{ name: 'kullanıcı', description: 'Öpülecek kişi', type: 6, required: false }]
    },
    {
        name: 'tokat',
        description: 'Birine tokat atar.',
        options: [{ name: 'kullanıcı', description: 'Tokatlanacak kişi', type: 6, required: false }]
    },
    {
        name: 'karakter',
        description: 'Karakter hikayesi gösterir.',
        options: [{ name: 'isim', description: 'Karakter adı', type: 3, required: true }]
    },
    {
        name: 'pp',
        description: 'Profil fotoğrafını gösterir.',
        options: [{ name: 'kullanıcı', description: 'Avatarına bakılacak kişi', type: 6, required: false }]
    },
    {
        name: 'blackjack',
        description: 'Blackjack (21) oynarsın.',
        options: [{ name: 'miktar', description: 'Bahis miktarı', type: 4, required: true }]
    },
    {
        name: 'mayın',
        description: 'Mayın tarlası oynarsın.',
        options: [
            { name: 'bahis', description: 'Bahis miktarı', type: 4, required: true },
            { name: 'sayı', description: 'Mayın sayısı (1-24)', type: 4, required: true }
        ]
    },
    { name: 'yardım', description: 'Bot komutlarını listeler.' },
    { name: 'ping', description: 'Botun gecikme süresini ölçer.' }
];

client.once("ready", async () => {
    console.log(`${client.user.tag} aktif!`);

    // Bot Durumu Ayarla
    client.user.setActivity('Davet etmek için : iandrexcb | 🚀 Nexora', { type: ActivityType.Watching });

    // Slash Komutlarını Kaydet
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        console.log('Slash komutları güncelleniyor...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: slashCommands },
        );
        console.log('Slash komutları başarıyla kaydedildi!');

        // Bot Aktif Bildirimi
        if (STATUS_CHANNEL_ID) {
            const channel = await client.channels.fetch(STATUS_CHANNEL_ID).catch(() => null);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle("🟢 Bot Aktif")
                    .setDescription("Nexora Bot başarıyla çevrimiçi oldu ve hizmet vermeye başladı.")
                    .setColor("#2ecc71")
                    .setTimestamp();
                channel.send({ embeds: [embed] }).catch(console.error);
            }
        }
    } catch (error) {
        console.error('Slash komut kaydı hatası:', error);
    }
});

// ---------------- SLASH KOMUT HANDLER ----------------
client.on('interactionCreate', async interaction => {
    const { commandName } = interaction;

    // ---------------- BİLEŞEN ETKİLEŞİMLERİ (MENÜLER & BUTONLAR) ----------------
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'market_select') {
            const item = interaction.values[0];
            const p_data = p_loadData();
            const price = p_data.market[item];

            const embed = new EmbedBuilder()
                .setTitle(`🛒 Satın Al: ${item.toUpperCase().replace("_", " ")}`)
                .setDescription(`Bu üründen kaç adet satın almak istersiniz?\n\n💰 Birim Fiyat: **${price} Coin**`)
                .setColor("#2ecc71")
                .setThumbnail(interaction.user.displayAvatarURL());

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`buy_1_${item}`)
                    .setLabel('1 Adet Al')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`buy_5_${item}`)
                    .setLabel('5 Adet Al')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`buy_cancel`)
                    .setLabel('İptal Et')
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.update({ embeds: [embed], components: [row] });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId.startsWith('buy_')) {
            if (interaction.customId === 'buy_cancel') {
                return await interaction.update({ content: "❌ İşlem iptal edildi.", embeds: [], components: [] });
            }

            const parts = interaction.customId.split('_');
            const amount = parseInt(parts[1]);
            const item = parts.slice(2).join('_');

            const p_data = p_loadData();
            const price = p_data.market[item];
            const totalPrice = price * amount;

            let para_data = para_yukle();
            const userPara = para_data[interaction.user.id] || 0;

            if (userPara < totalPrice) {
                return await interaction.reply({ content: `❌ Yetersiz bakiye! Gerekli: **${totalPrice}**, Sende olan: **${userPara}**`, ephemeral: true });
            }

            // İşlemi yap
            para_data[interaction.user.id] -= totalPrice;
            para_kaydet(para_data);

            p_checkUser(p_data, interaction.user.id);
            p_data.users[interaction.user.id].items[item] = (p_data.users[interaction.user.id].items[item] || 0) + amount;
            p_saveData(p_data);

            await interaction.update({
                content: `✅ Başarıyla **${amount}** adet **${item.toUpperCase()}** satın aldın! Toplam Ödenen: **${totalPrice} Coin**`,
                embeds: [],
                components: []
            });
        }
        else if (interaction.customId.startsWith('bj_')) {
            const parts = interaction.customId.split('_');
            const action = parts[1];
            const userId = parts[2];

            if (interaction.user.id !== userId) return await interaction.reply({ content: "Bu oyun senin değil!", ephemeral: true });

            const game = blackjackGames.get(userId);
            if (!game) return await interaction.update({ content: "Oyun süresi dolmuş veya oyun bulunamadı.", components: [], embeds: [] });

            let { deck, playerHand, dealerHand, miktar } = game;
            let para_data = para_yukle();
            const embed = new EmbedBuilder().setColor('#2f3136').setFooter({ text: `Bahis: ${miktar} coin` });

            if (action === 'hit') {
                playerHand.push(deck.pop());
                const playerScore = getScore(playerHand);

                if (playerScore > 21) {
                    blackjackGames.delete(userId);
                    embed.setTitle('🃏 Blackjack - KAYBETTİN! (BUST) 💀')
                        .setDescription(`Puanın 21'i geçti (**${playerScore}**). Bahsin olan **${miktar}** coin kasaya gitti.`)
                        .addFields(
                            { name: `Senin Elin (${playerScore})`, value: playerHand.map(c => `${c.value}${c.suit}`).join(' '), inline: true },
                            { name: `Kasa Eli (${getScore(dealerHand)})`, value: dealerHand.map(c => `${c.value}${c.suit}`).join(' '), inline: true }
                        )
                        .setColor('#ff4444');
                    return await interaction.update({ embeds: [embed], components: [] });
                }

                embed.setTitle('🃏 Blackjack')
                    .addFields(
                        { name: `Senin Elin (${playerScore})`, value: playerHand.map(c => `${c.value}${c.suit}`).join(' '), inline: true },
                        { name: `Kasa Eli (?)`, value: `${dealerHand[0].value}${dealerHand[0].suit} ❓`, inline: true }
                    );

                await interaction.update({ embeds: [embed] });

            } else if (action === 'stand') {
                let dealerScore = getScore(dealerHand);
                while (dealerScore < 17) {
                    dealerHand.push(deck.pop());
                    dealerScore = getScore(dealerHand);
                }

                const playerScore = getScore(playerHand);
                blackjackGames.delete(userId);

                let result = '';
                let winAmount = 0;

                if (dealerScore > 21 || playerScore > dealerScore) {
                    result = 'KAZANDIN! 🎉';
                    winAmount = miktar * 2;
                    para_data[userId] += winAmount;
                    para_kaydet(para_data);
                    embed.setColor('#2ecc71').setDescription(`Tebrikler! Kasayı yendin ve **${winAmount}** coin kazandın.`);
                } else if (playerScore < dealerScore) {
                    result = 'KAYBETTİN! 💀';
                    embed.setColor('#ff4444').setDescription(`Kasa seni yendi. **${miktar}** coin kaybettin.`);
                } else {
                    result = 'BERABERE! 🤝';
                    para_data[userId] += miktar;
                    para_kaydet(para_data);
                    embed.setColor('#f1c40f').setDescription(`Puanlar eşit, bahsin olan **${miktar}** coin iade edildi.`);
                }

                embed.setTitle(`🃏 Blackjack - ${result}`)
                    .addFields(
                        { name: `Senin Elin (${playerScore})`, value: playerHand.map(c => `${c.value}${c.suit}`).join(' '), inline: true },
                        { name: `Kasa Eli (${dealerScore})`, value: dealerHand.map(c => `${c.value}${c.suit}`).join(' '), inline: true }
                    );

                await interaction.update({ embeds: [embed], components: [] });
            }
        }

        if (interaction.customId.startsWith('mines_')) {
            const parts = interaction.customId.split('_');
            const action = parts[1];
            const val = parts[2];
            const userId = parts[3];

            if (interaction.user.id !== userId) return await interaction.reply({ content: "Bu oyun senin değil!", ephemeral: true });

            const game = minesGames.get(userId);
            if (!game) return await interaction.update({ content: "Oyun süresi dolmuş veya oyun bulunamadı.", components: [], embeds: [] });

            let { mines, revealed, bahis, mayinSayisi, totalTiles } = game;
            let para_data = para_yukle();

            if (action === 'reveal') {
                const index = parseInt(val);
                if (revealed.includes(index)) return await interaction.reply({ content: "Bu kare zaten açılmış!", ephemeral: true });

                if (mines.includes(index)) {
                    // KAYBETTİ
                    minesGames.delete(userId);
                    const embed = new EmbedBuilder()
                        .setTitle('💣 Mayın Tarlası - BOM! 💥')
                        .setDescription(`Mayına bastın! **${bahis}** coin kaybettin.`)
                        .setColor('#ff4444');

                    const rows = [];
                    for (let i = 0; i < 4; i++) {
                        const row = new ActionRowBuilder();
                        for (let j = 0; j < 5; j++) {
                            const idx = i * 5 + j;
                            const btn = new ButtonBuilder().setCustomId(`mines_disabled_${idx}`).setDisabled(true);
                            if (mines.includes(idx)) btn.setLabel('💣').setStyle(ButtonStyle.Danger);
                            else if (idx === index) btn.setLabel('💥').setStyle(ButtonStyle.Danger);
                            else btn.setLabel('?').setStyle(ButtonStyle.Secondary);
                            row.addComponents(btn);
                        }
                        rows.push(row);
                    }
                    return await interaction.update({ embeds: [embed], components: rows });
                }

                revealed.push(index);

                // Çarpan Hesaplama: C(20, m) / C(20-s, m)
                function combinations(n, k) {
                    if (k > n || k < 0) return 0;
                    if (k === 0 || k === n) return 1;
                    if (k > n / 2) k = n - k;
                    let res = 1;
                    for (let i = 1; i <= k; i++) res = res * (n - i + 1) / i;
                    return res;
                }

                const mult = (combinations(20, mayinSayisi) / combinations(20 - revealed.length, mayinSayisi)) * 0.98;
                game.multiplier = mult;
                minesGames.set(userId, game);

                const embed = new EmbedBuilder()
                    .setTitle('💣 Mayın Tarlası')
                    .setDescription(`**${mayinSayisi}** Mayın var. Kareleri açarak kazancını katla!\n\n💰 Bahis: **${bahis}**\n📈 Çarpan: **${mult.toFixed(2)}x**\n💵 Mevcut Kazanç: **${Math.floor(bahis * mult)}**`)
                    .setColor('#f1c40f');

                const rows = [];
                for (let i = 0; i < 4; i++) {
                    const row = new ActionRowBuilder();
                    for (let j = 0; j < 5; j++) {
                        const idx = i * 5 + j;
                        const btn = new ButtonBuilder().setCustomId(`mines_reveal_${idx}_${userId}`);
                        if (revealed.includes(idx)) btn.setLabel('💎').setStyle(ButtonStyle.Success).setDisabled(true);
                        else btn.setLabel('?').setStyle(ButtonStyle.Secondary);
                        row.addComponents(btn);
                    }
                    rows.push(row);
                }
                const controlRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`mines_cashout_0_${userId}`).setLabel(`Parayı Çek (${Math.floor(bahis * mult)})`).setStyle(ButtonStyle.Success)
                );
                rows.push(controlRow);

                await interaction.update({ embeds: [embed], components: rows });

            } else if (action === 'cashout') {
                const mult = game.multiplier;
                const winAmount = Math.floor(bahis * mult);
                para_data[userId] = (para_data[userId] || 0) + winAmount;
                para_kaydet(para_data);
                minesGames.delete(userId);

                const embed = new EmbedBuilder()
                    .setTitle('💰 Mayın Tarlası - KAZANDIN! 🎉')
                    .setDescription(`Harika! **${winAmount}** coin çekildi. \n\n📈 Final Çarpan: **${mult.toFixed(2)}x**`)
                    .setColor('#2ecc71');

                const rows = [];
                for (let i = 0; i < 4; i++) {
                    const row = new ActionRowBuilder();
                    for (let j = 0; j < 5; j++) {
                        const idx = i * 5 + j;
                        const btn = new ButtonBuilder().setCustomId(`mines_disabled_${idx}`).setDisabled(true);
                        if (mines.includes(idx)) btn.setLabel('💣').setStyle(ButtonStyle.Secondary);
                        else if (revealed.includes(idx)) btn.setLabel('💎').setStyle(ButtonStyle.Success);
                        else btn.setLabel('?').setStyle(ButtonStyle.Secondary);
                        row.addComponents(btn);
                    }
                    rows.push(row);
                }
                await interaction.update({ embeds: [embed], components: rows });
            }
        }
    }

    if (!interaction.isChatInputCommand()) return;

    if (commandName === 'ping') {
        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
        interaction.editReply(`🏓 Pong! Gecikme: ${sent.createdTimestamp - interaction.createdTimestamp}ms`);
    }

    else if (commandName === 'bakiye') {
        hesap_olustur(interaction.user.id);
        const data = para_yukle();
        const para = data[interaction.user.id];
        await interaction.reply(`💰 ${interaction.user} bakiyen: ${para} coin`);
    }

    else if (commandName === 'pp') {
        const user = interaction.options.getUser('kullanıcı') || interaction.user;

        const avatarCard = await new canvafy.Ship()
            .setAvatars(user.displayAvatarURL({ forceStatic: true, extension: "png" }), client.user.displayAvatarURL({ forceStatic: true, extension: "png" }))
            .setBackground("color", "#2f3136")
            .setBorder("#2ecc71")
            .setOverlayOpacity(0.5)
            .build();

        // Aslında sadece avatarı büyük göstermek daha iyidir ama kullanıcı "görsel yap" dediği için 
        // Canvafy ile bir profil kartı gibi sunuyorum. Alternatif: Sadece AttachmentBuilder ile süslemek.
        // Ama en iyisi Canvafy'nin Welcome kartını Profile gibi modifiye etmek.

        const profile = await new canvafy.WelcomeLeave()
            .setAvatar(user.displayAvatarURL({ forceStatic: true, extension: "png" }))
            .setBackground("color", "#2f3136")
            .setTitle(user.username.substring(0, 20))
            .setDescription("Nexora Kullanıcı Profili".substring(0, 80))
            .setBorder("#2ecc71")
            .setAvatarBorder("#2ecc71")
            .build();

        const attachment = new AttachmentBuilder(profile, { name: `profile-${user.id}.png` });
        await interaction.reply({ files: [attachment] });
    }

    else if (commandName === 'yardım') {
        const embed = new EmbedBuilder()
            .setTitle("📜 Bot Komutları")
            .setDescription("Prefix: `n!` veya `/` kullanarak Slash komutlarını deneyebilirsin! 👇")
            .setColor(0x0000FF)
            .addFields(
                { name: "💰 Ekonomi", value: "`n!bakiye` - Bakiyeni gösterir\n`n!gunluk` - Günlük para alırsın\n`n!slot <miktar>` - Slot oynarsın\n`n!zenginler` - En zenginleri gösterir\n`n!paraat @kişi <miktar>` - Para gönderirsin\n`n!market` - Eşya fiyatlarını görürsün\n`n!satınal <ürün> <miktar>` - Eşya alırsın\n`n!sat <ürün> <miktar>` - Eşya satarsın\n`n!envanter` - Eşyalarını görürsün", inline: false },
                { name: "📈 Level Sistemi", value: "`n!level` - Seviyeni ve XP'ni gösterir", inline: false },
                { name: "� Kumar Oyunları", value: "`/blackjack <bahis>` - 21 Oynarsın\n`/mayın <bahis> <mayın_sayısı>` - Mayın tarlası oynarsın", inline: false },
                { name: "�🎮 Eğlence & Müzik", value: "`nex <herhangi bir şey>` - Yapay zeka (BETA) ile sohbet\n`n!karakter <isim>` - Karakter hikayeleri (Wikipedia destekli)\n`n!çal <şarkı>` - Müzik çalar\n`n!geç` - Şarkıyı geçer\n`n!dur`/`n!devam` - Müziği yönetir\n`n!sıra` - Kuyruğu gösterir\n`n!ses <0-100>` - Ses seviyesini ayarlar\n`n!döngü` - Şarkıyı tekrarlar\n`n!çık` - Ses kanalından çıkar\n`n!ego` - Kim egolu seçer\n`n!roast @kişi` - Laf sokar\n`n!taş` - TKM oynarsın\n`n!sarıl`/`n!op`/`n!tokat` - Gif atar\n`n!pp @kişi` - Avatarını gösterir\n`n!üye` - Sunucu istatistikleri", inline: false }
            )
            .setFooter({ text: "NEXORA BOT | Tüm Sistemler Aktif" });
        await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'gunluk') {
        hesap_olustur(interaction.user.id);
        let data = para_yukle();
        if (!data.gunluk_zaman) data.gunluk_zaman = {};
        const sId = interaction.user.id;
        const su_an = Math.floor(Date.now() / 1000);
        if (data.gunluk_zaman[sId] && (su_an - data.gunluk_zaman[sId]) < 86400) {
            const kalan = 86400 - (su_an - data.gunluk_zaman[sId]);
            return await interaction.reply(`⏳ Beklemelisin: ${Math.floor(kalan / 3600)}sa ${Math.floor((kalan % 3600) / 60)}dk`);
        }
        data[sId] = (data[sId] || 0) + 100;
        data.gunluk_zaman[sId] = su_an;
        para_kaydet(data);
        await interaction.reply(`💵 100 coin aldın!`);
    }

    else if (commandName === 'slot') {
        const miktar = interaction.options.getInteger('miktar');
        const userId = interaction.user.id;
        const now = Date.now();
        const cooldownAmount = 5000;

        if (slotCooldowns.has(userId)) {
            const expirationTime = slotCooldowns.get(userId) + cooldownAmount;
            if (now < expirationTime) {
                const timeLeft = (expirationTime - now) / 1000;
                return await interaction.reply(`⏳ Yavaş kanka! ${timeLeft.toFixed(1)} saniye bekle.`);
            }
        }

        hesap_olustur(userId);
        let data = para_yukle();
        if (data[userId] < miktar) return await interaction.reply("Yeterli paran yok 😈");

        slotCooldowns.set(userId, now);
        setTimeout(() => slotCooldowns.delete(userId), cooldownAmount);

        const semboller = ["🍒", "🍋", "💎", "7️⃣"];
        const sonuc = [semboller[Math.floor(Math.random() * semboller.length)], semboller[Math.floor(Math.random() * semboller.length)], semboller[Math.floor(Math.random() * semboller.length)]];
        const sans = Math.floor(Math.random() * 100) + 1;
        let msg = "";
        if (sans <= 5) { data[userId] += miktar * 4; msg = `🎰 ${sonuc.join(' ')}\n💎 JACKPOT! +${miktar * 4} coin`; }
        else if (sans <= 25) { data[userId] += miktar * 2; msg = `🎰 ${sonuc.join(' ')}\n🎉 Kazandın! +${miktar * 2} coin`; }
        else if (sans <= 50) { msg = `🎰 ${sonuc.join(' ')}\n😐 Berabere! Paran geri.`; }
        else { data[userId] -= miktar; msg = `🎰 ${sonuc.join(' ')}\n💀 Kaybettin! -${miktar} coin`; }
        para_kaydet(data);
        await interaction.reply(msg);
    }

    else if (commandName === 'zenginler') {
        const data = para_yukle();
        const temiz = Object.entries(data).filter(([k]) => k !== "gunluk_zaman").sort((a, b) => b[1] - a[1]).slice(0, 5);
        const embed = new EmbedBuilder().setTitle("🏆 En Zenginler").setColor(0xFFD700);
        for (let i = 0; i < temiz.length; i++) {
            const user = interaction.guild.members.cache.get(temiz[i][0]) || await interaction.guild.members.fetch(temiz[i][0]).catch(() => null);
            if (user) embed.addFields({ name: `${i + 1}. ${user.user.username}`, value: `💰 ${temiz[i][1]} coin` });
        }
        await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'paraat') {
        const uye = interaction.options.getUser('kullanıcı');
        const miktar = interaction.options.getInteger('miktar');
        if (uye.id === interaction.user.id) return await interaction.reply("Kendine atamazsın!");
        let data = para_yukle();
        if ((data[interaction.user.id] || 0) < miktar) return await interaction.reply("Yetersiz bakiye!");
        data[interaction.user.id] -= miktar;
        data[uye.id] = (data[uye.id] || 0) + miktar;
        para_kaydet(data);
        await interaction.reply(`✅ ${uye} kişisine ${miktar} coin gönderildi!`);
    }

    else if (commandName === 'market') {
        const p_data = p_loadData();
        p_updateMarket(p_data);
        const embed = new EmbedBuilder()
            .setTitle("🏪 NEXORA GLOBAL MARKET")
            .setColor("#f1c40f")
            .setDescription("Lütfen satın almak istediğiniz ürünü aşağıdaki menüden seçin.")
            .setFooter({ text: "Fiyatlar saatlik olarak güncellenir." });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('market_select')
            .setPlaceholder('Bir ürün seçin...')
            .addOptions(
                Object.keys(p_data.market).map(item => ({
                    label: item.toUpperCase().replace("_", " "),
                    description: `Fiyat: ${p_data.market[item]} Coin | Değişim: ${p_data.marketChanges[item] || "0%"}`,
                    value: item,
                    emoji: "📦"
                }))
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        for (const item in p_data.market) {
            embed.addFields({
                name: item.toUpperCase().replace("_", " "),
                value: `💰 **${p_data.market[item]}** Coin\n💹 **${p_data.marketChanges[item] || "0%"}**`,
                inline: true
            });
        }

        await interaction.reply({ embeds: [embed], components: [row] });
    }

    else if (commandName === 'satınal') {
        const item = interaction.options.getString('ürün').toLowerCase();
        const miktar = interaction.options.getInteger('miktar') || 1;
        const p_data = p_loadData();
        if (!p_data.market[item]) return await interaction.reply("Ürün yok!");
        let data = para_yukle();
        if ((data[interaction.user.id] || 0) < p_data.market[item] * miktar) return await interaction.reply("Yetersiz bakiye!");
        data[interaction.user.id] -= p_data.market[item] * miktar;
        para_kaydet(data);
        p_checkUser(p_data, interaction.user.id);
        p_data.users[interaction.user.id].items[item] = (p_data.users[interaction.user.id].items[item] || 0) + miktar;
        p_saveData(p_data);
        await interaction.reply(`✅ ${miktar} ${item} alındı!`);
    }

    else if (commandName === 'sat') {
        const item = interaction.options.getString('ürün').toLowerCase();
        const miktar = interaction.options.getInteger('miktar') || 1;
        const p_data = p_loadData();
        p_checkUser(p_data, interaction.user.id);
        if ((p_data.users[interaction.user.id].items[item] || 0) < miktar) return await interaction.reply("Yetersiz ürün!");
        let data = para_yukle();
        data[interaction.user.id] = (data[interaction.user.id] || 0) + p_data.market[item] * miktar;
        para_kaydet(data);
        p_data.users[interaction.user.id].items[item] -= miktar;
        p_saveData(p_data);
        await interaction.reply(`💰 ${miktar} ${item} satıldı!`);
    }

    else if (commandName === 'envanter') {
        const p_data = p_loadData();
        p_checkUser(p_data, interaction.user.id);
        const para_data = para_yukle();
        const bakiye = para_data[interaction.user.id] || 0;
        let items = `💰 Bakiyen: **${bakiye} coin**\n\n`;
        let hasItems = false;
        for (const i in p_data.users[interaction.user.id].items) {
            if (p_data.users[interaction.user.id].items[i] > 0) {
                items += `• ${i.toUpperCase().replace("_", " ")}: ${p_data.users[interaction.user.id].items[i]}\n`;
                hasItems = true;
            }
        }
        if (!hasItems) items += "*Envanterin boş.*";
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`🎒 ${interaction.user.username} Envanteri`).setDescription(items).setColor("#3498db")] });
    }

    else if (commandName === 'sans') {
        const p_data = p_loadData();
        p_checkUser(p_data, interaction.user.id);
        const p_user = p_data.users[interaction.user.id];
        const now = Date.now();
        if (now - p_user.lastLuckUse < 86400000) {
            const rem = 86400000 - (now - p_user.lastLuckUse);
            return await interaction.reply(`⏳ Beklemelisin: ${Math.floor(rem / 3600000)}sa ${Math.floor((rem % 3600000) / 60000)}dk`);
        }
        p_user.dailyLuck = Math.floor(Math.random() * 100) + 1;
        p_user.lastLuckUse = now;
        p_saveData(p_data);
        await interaction.reply(`Bugünkü şansın %${p_user.dailyLuck} 🍀`);
    }

    else if (commandName === 'tahmin') {
        const guess = interaction.options.getInteger('sayı');
        const p_data = p_loadData();
        p_checkUser(p_data, interaction.user.id);
        const p_user = p_data.users[interaction.user.id];
        const now = Date.now();

        if (now - p_user.lastLuckUse >= 86400000 || p_user.lastLuckUse === 0) return await interaction.reply("❌ Önce `/sans` kullanmalısın.");

        const today = new Date().setHours(0, 0, 0, 0);
        if (p_user.lastTahminReset < today) {
            p_user.tahminCount = 0;
            p_user.lastTahminReset = today;
        }

        if (p_user.tahminCount >= 2) return await interaction.reply("❌ Bugünkü tahmin haklarını bitirdin!");

        p_user.tahminCount++;
        const botNum = Math.floor(Math.random() * 10) + 1;
        if (guess === botNum) {
            let gift = p_user.dailyLuck <= 50 ? "tuvalet_kagidi" : (p_user.dailyLuck <= 75 ? "altin" : (p_user.dailyLuck <= 90 ? "yakut" : "elmas"));
            p_user.items[gift] = (p_user.items[gift] || 0) + 1;
            await interaction.reply(`🎯 DOĞRU! Sayı ${botNum} idi. Ödülün: 1x ${gift.toUpperCase()}\n(Kalan hak: ${2 - p_user.tahminCount})`);
        } else {
            await interaction.reply(` Maalesef yanlış! Doğru sayı: ${botNum}\n(Kalan hak: ${2 - p_user.tahminCount})`);
        }
        p_saveData(p_data);
    }

    else if (commandName === 'level') {
        const user = interaction.options.getUser('kullanıcı') || interaction.user;
        const xpData = xp_yukle();
        const xp = xpData[user.id] || 0;
        const level = Math.floor(Math.sqrt(xp / 300));
        const currentLevelXp = Math.pow(level, 2) * 300;
        const nextLevelXp = Math.pow(level + 1, 2) * 300;
        const xpRequired = nextLevelXp - currentLevelXp;
        const xpCurrent = xp - currentLevelXp;

        // Bakiye bilgisini de alalım
        const para_data = para_yukle();
        const bakiye = para_data[user.id] || 0;

        const status = user.presence?.status || "offline";
        const rankCard = await new canvafy.Rank()
            .setAvatar(user.displayAvatarURL({ forceStatic: true, extension: "png" }))
            .setBackground("color", "#23272a")
            .setUsername(user.username)
            .setStatus(status === "invisible" ? "offline" : (status === "dnd" ? "dnd" : (status === "idle" ? "idle" : (status === "online" ? "online" : "offline"))))
            .setLevel(level)
            .setRank(1, "Sıra", false)
            .setCurrentXp(xpCurrent)
            .setRequiredXp(xpRequired)
            .setBarColor("#2ecc71")
            .build();

        const attachment = new AttachmentBuilder(rankCard, { name: `rankcard-${user.id}.png` });
        await interaction.reply({ files: [attachment] });
    }

    else if (commandName === 'çal') {
        const query = interaction.options.getString('şarkı');
        const member = interaction.member;
        if (!member.voice.channel) return await interaction.reply("Ses kanalına gir!");
        let connection = getVoiceConnection(interaction.guildId);
        if (!connection) connection = joinVoiceChannel({ channelId: member.voice.channel.id, guildId: interaction.guildId, adapterCreator: interaction.guild.voiceAdapterCreator });
        musicQueue.push({ query, message: { author: interaction.user, channel: interaction.channel, guild: interaction.guild } });
        if (player.state.status !== AudioPlayerStatus.Playing) {
            await playNext({ author: interaction.user, channel: interaction.channel, guild: interaction.guild });
            await interaction.reply(`🎶 **${query}** çalınıyor...`);
        } else {
            await interaction.reply(`✅ **${query}** sıraya eklendi!`);
        }
    }

    else if (commandName === 'geç') { player.stop(); await interaction.reply("⏭️ Şarkı geçildi."); }
    else if (commandName === 'dur') { player.pause(); await interaction.reply("⏸️ Durduruldu."); }
    else if (commandName === 'devam') { player.unpause(); await interaction.reply("▶️ Devam ediyor."); }
    else if (commandName === 'sıra') {
        let l = "";
        for (let i = 0; i < Math.min(musicQueue.length, 5); i++) l += `${i + 1}. ${musicQueue[i].query}\n`;
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle("🎼 Kuyruk").setDescription(l || "Boş")] });
    }
    else if (commandName === 'ses') {
        const v = interaction.options.getInteger('seviye');
        if (currentResource) { currentResource.volume.setVolume(v / 100); await interaction.reply(`🔊 Ses: %${v}`); }
        else await interaction.reply("Çalan bir şey yok!");
    }
    else if (commandName === 'döngü') { isLooping = !isLooping; await interaction.reply(`🔄 Döngü: ${isLooping ? "Açık" : "Kapalı"}`); }
    else if (commandName === 'çık') {
        const c = getVoiceConnection(interaction.guildId);
        if (c) { c.destroy(); musicQueue = []; isLooping = false; await interaction.reply("👋 Çıktım."); }
    }

    else if (commandName === 'ego') {
        const type = 'ego.json';
        let d = loadJSON(type);
        const tid = new Date().toISOString().slice(0, 10);
        if (d[interaction.guildId]?.tarih === tid) {
            const u = interaction.guild.members.cache.get(d[interaction.guildId].id);
            return await interaction.reply(`Bugünün egosusu: ${u || "Bilinmiyor"}`);
        }
        const m = interaction.guild.members.cache.filter(m => !m.user.bot).random();
        d[interaction.guildId] = { id: m.id, tarih: tid };
        saveJSON(type, d);
        await interaction.reply(`Bugünün egosusu: ${m}`);
    }

    else if (commandName === 'roast') {
        const u = interaction.options.getUser('kullanıcı');
        await interaction.reply(`🔥 ${u} ${roastlar[Math.floor(Math.random() * roastlar.length)]}`);
    }

    else if (commandName === 'tkm') {
        const s = interaction.options.getString('seçim');
        const b = ["taş", "kağıt", "makas"][Math.floor(Math.random() * 3)];
        let r = s === b ? "Berabere!" : ((s === "taş" && b === "makas") || (s === "kağıt" && b === "taş") || (s === "makas" && b === "kağıt") ? "Kazandın!" : "Kaybettin!");
        await interaction.reply(`Sen: ${s} | Bot: ${b}\nSonuç: ${r}`);
    }

    else if (commandName === 'üye') {
        await interaction.reply(`👥 Toplam Üye: ${interaction.guild.memberCount}`);
    }

    else if (commandName === 'sarıl' || commandName === 'op' || commandName === 'tokat') {
        const u = interaction.options.getUser('kullanıcı');
        if (u && u.id === interaction.user.id) {
            if (commandName === 'sarıl') return await interaction.reply("Kendine sarılmak mı... gel buraya ben sarılayım 🫂");
        }
        const tag = commandName === 'sarıl' ? 'hug' : (commandName === 'op' ? 'kiss' : 'slap');
        try {
            const r = await fetch(`https://api.giphy.com/v1/gifs/random?api_key=${GIPHY_API_KEY}&tag=${tag}&rating=pg`);
            const j = await r.json();
            const gifUrl = j.data.images.original.url;
            let desc = commandName === 'sarıl' ? (u ? `${interaction.user}, ${u} kişisine sarıldı 🤗` : `${interaction.user} herkese sarıldı 🤗`) : (commandName === 'op' ? (u ? `${interaction.user}, ${u} kişisini öptü 🤗` : `${interaction.user} herkesi öptü 🤗`) : (u ? `${interaction.user}, ${u} kişisine tokat attı 👋` : `${interaction.user} herkese tokat attı 👋`));
            const e = new EmbedBuilder().setDescription(desc).setColor(0xFFC0CB).setImage(gifUrl);
            await interaction.reply({ embeds: [e] });
        } catch (err) {
            await interaction.reply("Gif çekilirken hata oluştu.");
        }
    }

    else if (commandName === 'blackjack') {
        const miktar = interaction.options.getInteger('miktar');
        const userId = interaction.user.id;

        hesap_olustur(userId);
        let para_data = para_yukle();
        if ((para_data[userId] || 0) < miktar) return await interaction.reply({ content: "❌ Yetersiz bakiye!", ephemeral: true });

        // Parayı baştan düş
        para_data[userId] -= miktar;
        para_kaydet(para_data);

        const deck = createDeck();
        const playerHand = [deck.pop(), deck.pop()];
        const dealerHand = [deck.pop(), deck.pop()];

        const playerScore = getScore(playerHand);
        const dealerScore = getScore(dealerHand);

        blackjackGames.set(userId, { deck, playerHand, dealerHand, miktar });

        const embed = new EmbedBuilder()
            .setTitle('🃏 Blackjack')
            .setColor('#2f3136')
            .addFields(
                { name: `Senin Elin (${playerScore})`, value: playerHand.map(c => `${c.value}${c.suit}`).join(' '), inline: true },
                { name: `Kasa Eli (?)`, value: `${dealerHand[0].value}${dealerHand[0].suit} ❓`, inline: true }
            )
            .setFooter({ text: `Bahis: ${miktar} coin` });

        if (playerScore === 21) {
            para_data[userId] += Math.floor(miktar * 2.5);
            para_kaydet(para_data);
            blackjackGames.delete(userId);
            embed.setTitle('🃏 Blackjack - KAZANDIN! 🎉')
                .setDescription(`Müthiş! Blackjack yaptın ve **${Math.floor(miktar * 2.5)}** coin kazandın.`)
                .setFields(
                    { name: `Senin Elin (${playerScore})`, value: playerHand.map(c => `${c.value}${c.suit}`).join(' '), inline: true },
                    { name: `Kasa Eli (${dealerScore})`, value: dealerHand.map(c => `${c.value}${c.suit}`).join(' '), inline: true }
                );
            return await interaction.reply({ embeds: [embed] });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bj_hit_${userId}`).setLabel('Kart Çek').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`bj_stand_${userId}`).setLabel('Dur').setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
    }

    else if (commandName === 'mayın') {
        const bahis = interaction.options.getInteger('bahis');
        const mayinSayisi = interaction.options.getInteger('sayı');
        const userId = interaction.user.id;

        if (mayinSayisi < 1 || mayinSayisi > 24) return await interaction.reply({ content: "❌ Mayın sayısı 1 ile 24 arasında olmalıdır!", ephemeral: true });

        hesap_olustur(userId);
        let para_data = para_yukle();
        if ((para_data[userId] || 0) < bahis) return await interaction.reply({ content: "❌ Yetersiz bakiye!", ephemeral: true });

        // Parayı baştan düş
        para_data[userId] -= bahis;
        para_kaydet(para_data);

        // Mayınları yerleştir
        const positions = Array.from({ length: 25 }, (_, i) => i);
        const mines = [];
        for (let i = 0; i < mayinSayisi; i++) {
            const index = Math.floor(Math.random() * positions.length);
            mines.push(positions.splice(index, 1)[0]);
        }

        minesGames.set(userId, { mines, revealed: [], bahis, mayinSayisi, multiplier: 1 });

        const embed = new EmbedBuilder()
            .setTitle('💣 Mayın Tarlası')
            .setDescription(`**${mayinSayisi}** Mayın var. Kareleri açarak kazancını katla!\n\n💰 Bahis: **${bahis}**\n📈 Çarpan: **1.00x**\n💵 Mevcut Kazanç: **0**`)
            .setColor('#f1c40f')
            .setFooter({ text: 'Mayına basarsan kaybedersin!' });

        const rows = [];
        for (let i = 0; i < 5; i++) {
            const row = new ActionRowBuilder();
            for (let j = 0; j < 5; j++) {
                const index = i * 5 + j;
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`mines_reveal_${index}_${userId}`)
                        .setLabel('?')
                        .setStyle(ButtonStyle.Secondary)
                );
            }
            rows.push(row);
        }

        // Cashout butonu için ayrı bir satır (Discord max 5 satır izin veriyor, ama biz 5x5 kullanıyoruz)
        // 5x5 kullandığımızda 5 satır doluyor. Cashout butonunu mesajın üstüne veya altına eklemeliyiz.
        // Alternatif: 4x5 ızgara + 1 satır butonlar. Ya da 5x5 ızgara içindeki bir butonu Cashout yapmak.
        // En iyisi 4x5 ızgara (20 kare) veya 5 satırı aşmamak.
        // Discord sınırı: 5 Action Row.
        // Eğer 5 satır slot kullanırsak Cashout'u nereye koyacağız?
        // Çözüm: 4 satır ızgara (20 kare) + 1 satır (Cashout butonu).
        // VEYA 5 satır ızgara yapıp, yanına bir takip mesajı ile Cashout butonu eklemek (ama bu karmaşık olur).
        // 4x5 (20 kare) yapalım, daha temiz olur.

        minesGames.set(userId, { mines, revealed: [], bahis, mayinSayisi, multiplier: 1, totalTiles: 20 });

        const rowsUpdated = [];
        for (let i = 0; i < 4; i++) {
            const row = new ActionRowBuilder();
            for (let j = 0; j < 5; j++) {
                const index = i * 5 + j;
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`mines_reveal_${index}_${userId}`)
                        .setLabel('?')
                        .setStyle(ButtonStyle.Secondary)
                );
            }
            rowsUpdated.push(row);
        }

        const controlRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`mines_cashout_0_${userId}`)
                .setLabel('Parayı Çek (Cashout)')
                .setStyle(ButtonStyle.Success)
                .setDisabled(true)
        );
        rowsUpdated.push(controlRow);

        await interaction.reply({ embeds: [embed], components: rowsUpdated });
    }
    else if (commandName === 'karakter') {
        const n = interaction.options.getString('isim');
        try {
            let wikiUrl = `https://tr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(n)}`;
            let resp = await fetch(wikiUrl);
            let data = await resp.json();

            if (data.type === 'disambiguation' || data.status === 404) {
                wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(n)}`;
                resp = await fetch(wikiUrl);
                data = await resp.json();
            }

            if (data.title && data.extract && data.type !== 'disambiguation' && data.status !== 404) {
                const embed = new EmbedBuilder()
                    .setTitle(`${data.title}`)
                    .setDescription(data.extract.length > 1000 ? data.extract.substring(0, 1000) + "..." : data.extract)
                    .setColor("#3498db")
                    .setThumbnail(data.thumbnail ? data.thumbnail.source : null)
                    .setFooter({ text: "Kaynak: Wikipedia | Nexora Bot" });
                await interaction.reply({ embeds: [embed] });
            } else {
                await interaction.reply("Bulunamadı.");
            }
        } catch (e) {
            await interaction.reply("❌ Bilgi aranırken bir hata oluştu.");
        }
    }
});

client.on('error', (err) => {
    console.error('Bot Error:', err);
});

// ---------------- ROASTLAR ----------------
const roastlar = [
    "Beynini WiFi'a bağlasak sinyal zayıf der.",
    "Sen NPC olsan kimse görev almaz.",
    "Google seni arasa sonuç bulunamadı der.",
    "Karizma yükleniyor... %1 kaldı.",
    "Seni görünce sistem hata veriyor.",
    "Sen güncelleme alsan bile buglı kalırsın.",
    "Senin özgüven nereden drop oluyor?",
    "Hayat sana easy mod vermiş yine zorlanmışsın.",
    "Sen loading screen'de takılı kalmış gibisin.",
    "Sen konuşunca altyazı lazım oluyor.",
    "Senin şansın low battery modda.",
    "Karizma.exe çalışmayı durdurdu.",
    "Senin aura 144p.",
    "Sen puzzle olsan eksik parça çıkarsın.",
    "Sen challenge değilsin, tutorial bölümüsün.",
    "Senin beyin RAM yükseltmesi istiyor.",
    "Sen offline takıl daha iyi.",
    "Senin vibe demo sürüm gibi.",
    "Sen hata kodu 404.",
    "Sen reset atsan da düzelmezsin.",
    "Sen random event gibisin, gereksiz.",
    "Senin özgüven crackli mi?",
    "Sen beta sürüm olarak kalmışsın.",
    "Sen konuşunca ortam ping yapıyor.",
    "Sen side quest bile değilsin.",
    "Sen kendine güncelleme notu yazsan kimse okumaz.",
    "Senin karizma deneme sürümü.",
    "Sen AFK kalsan fark edilmez.",
    "Senin aura airplane mode.",
    "Senin espriler 2008'den kalma.",
    "Senin stil varsayılan ayar.",
    "Sen konuşunca Discord çöker.",
    "Senin hayat tutorial bitmemiş.",
    "Senin özgüven deneme paketi.",
    "Sen screenshot olsan bulanık çıkarsın.",
    "Senin zeka internet kotası gibi sınırlı.",
    "Senin karizma arka planda çalışmıyor.",
    "Sen oyun olsan kimse indirmez.",
    "Sen mini mapte bile görünmezsin.",
    "Sen karakter seçme ekranında kalmışsın.",
    "Sen konuşunca mikrofon cızırtı yapıyor gibi.",
    "Sen default skin.",
    "Senin vibe bakımda.",
    "Senin aura düşük grafik ayarı.",
    "Sen online olunca kimse notice almaz.",
    "Senin özgüven fake hesap gibi.",
    "Sen hikaye modunda kaybolmuşsun.",
    "Sen günün bugı seçildin.",
    "Sen random spawn.",
    "Sen update bekleyen dosya gibisin.",
    "Senin karizma stokta yok.",
    "Sen konuşunca internet kesiliyor sanıyorum.",
    "Sen low effort.",
    "Sen system error mesajısın.",
    "Sen yan görev bile değilsin.",
    "Senin özgüven cache temizlenmeli.",
    "Sen challenge sandım ama tutorial çıktın.",
    "Senin enerji tasarruf modunda.",
    "Senin karizma arka planda yükleniyor.",
    "Sen glitch olmuş karakter gibisin.",
    "Sen oyun içi reklam gibisin.",
    "Senin vibe test yayını.",
    "Senin beyin 2G çekiyor.",
    "Sen patch notes'ta bile yoksun.",
    "Senin aura beta test.",
    "Sen save almadan kapatılmış oyun gibisin.",
    "Sen ekran koruyucu gibisin.",
    "Sen karakter oluşturma ekranında takılmışsın.",
    "Senin özgüven deneme sürümü bitmiş.",
    "Sen sistem gereksinimlerini karşılamıyorsun.",
    "Senin vibe düşük FPS.",
    "Senin karizma bağlantı hatası.",
    "Sen arka planda gereksiz uygulama gibisin.",
    "Sen NPC bile olamazsın.",
    "Sen karakter slotunu doldurmuşsun sadece.",
    "Senin aura internet explorer.",
    "Senin özgüven 1 bar.",
    "Sen konuşunca kalite düşüyor.",
    "Sen demo sürümün demosu gibisin.",
    "Sen glitchli skin.",
    "Sen tutorialda elenen oyuncusun.",
    "Senin vibe 360p canlı yayın.",
    "Senin karizma bakım modunda.",
    "Sen sistem güncellemesi bekliyorsun.",
    "Sen oyunda AFK farm yapan tipsin.",
    "Senin aura düşük ping hayali.",
    "Sen hata raporu gibisin.",
    "Senin özgüven düşük batarya.",
    "Sen ekran kartı sürücüsü güncel değil.",
    "Senin karizma beta aşamasında.",
    "Sen oyun başlarken çıkan uyarı gibisin.",
    "Sen gereksiz bildirim.",
    "Senin vibe sessize alınmış.",
    "Sen test sunucusundan kaçmış gibisin.",
    "Senin karizma arşivlenmiş.",
    "Sen low graphics preset.",
    "Sen sistem gereksiz dosyası."
];

// ---------------- KARAKTERLER ----------------
// ---------------- KARAKTERLER ----------------
const karakterler = {
    "steve": {
        ad: "Steve",
        oyun: "Minecraft",
        hikaye: "Steve, Minecraft dünyasının asıl kahramanıdır. Kim olduğu veya nereden geldiği tam olarak bilinmese de, uçsuz bucaksız bir dünyada hayatta kalma ve inşa etme yeteneğiyle tanınır. Bir efsaneye göre, o kadim bir halkın son temsilcisidir. Ejderhaları deviren, kaleler inşa eden ve her sabah güneşin doğuşuyla yeniden doğan Steve, yaratıcılığın ve cesaretin simgesidir.",
        renk: "#00AAAA",
        resim: "https://static.wikia.nocookie.net/minecraft_gamepedia/images/d/d1/Steve_New.png"
    }
};

// ---------------- KOMUTLAR VE MESAJLAR ----------------

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // XP SİSTEMİ
    const xpData = xp_yukle();
    const uId = message.author.id;
    const now = Date.now();
    const xpCooldown = 60000; // 60 saniye cooldown

    if (!xpCooldowns.has(uId) || (now - xpCooldowns.get(uId)) > xpCooldown) {
        if (!xpData[uId]) xpData[uId] = 0;

        const kazanilan = Math.floor(Math.random() * (10 - 2 + 1)) + 2; // XP kazancı biraz düşürüldü
        const eskiLevel = Math.floor(Math.sqrt(xpData[uId] / 300));
        xpData[uId] += kazanilan;
        const yeniLevel = Math.floor(Math.sqrt(xpData[uId] / 300));

        if (yeniLevel > eskiLevel) {
            message.channel.send(`🎉 ${message.author} tebrikler! **Level ${yeniLevel}** oldun! 🚀`);
        }
        xp_kaydet(xpData);
        xpCooldowns.set(uId, now);
    }

    const prefix = prefixes.find(p => message.content.startsWith(p));
    if (!prefix) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ---------------- VERİ YÜKLEME ----------------
    const p_data = p_loadData();
    p_updateMarket(p_data);
    p_checkUser(p_data, message.author.id);
    const p_user = p_data.users[message.author.id];
    let mainParaData = para_yukle();
    const userPara = mainParaData[message.author.id] || 0;

    // ---------------- EKONOMİ KOMUTLARI ----------------

    if (command === "bakiye") {
        hesap_olustur(message.author.id);
        const data = para_yukle();
        const para = data[message.author.id];
        message.channel.send(`💰 ${message.author} bakiyen: ${para} coin`);
    }

    else if (command === "gunluk") {
        hesap_olustur(message.author.id);
        let data = para_yukle();
        if (!data.gunluk_zaman) data.gunluk_zaman = {};

        const sUserId = message.author.id.toString();
        const su_an = Math.floor(Date.now() / 1000);

        if (data.gunluk_zaman[sUserId]) {
            let storedTime = data.gunluk_zaman[sUserId];
            // If storedTime is in milliseconds (greater than 10^12), convert to seconds
            if (storedTime > 10000000000) {
                storedTime = Math.floor(storedTime / 1000);
                data.gunluk_zaman[sUserId] = storedTime;
            }

            const gecen_sure = su_an - storedTime;
            if (gecen_sure < 86400) {
                const kalan = 86400 - gecen_sure;
                const saat = Math.floor(kalan / 3600);
                const dakika = Math.floor((kalan % 3600) / 60);
                return message.channel.send(`⏳ ${message.author} Zaten günlük ödülünü almışsın! Tekrar almak için **${saat} saat ${dakika} dakika** beklemelisin.`);
            }
        }

        data[sUserId] = (data[sUserId] || 0) + 100;
        data.gunluk_zaman[sUserId] = su_an;
        para_kaydet(data);
        message.channel.send(`💵 ${message.author} günlük 100 coin aldı!`);
    }

    else if (command === "slot") {
        const userId = message.author.id;
        const now = Date.now();
        const cooldownAmount = 5000; // 5 seconds

        if (slotCooldowns.has(userId)) {
            const expirationTime = slotCooldowns.get(userId) + cooldownAmount;
            if (now < expirationTime) {
                const timeLeft = (expirationTime - now) / 1000;
                return message.channel.send(`⏳ Yavaş kanka! ${timeLeft.toFixed(1)} saniye bekle.`);
            }
        }

        const miktar = parseInt(args[0]);
        if (isNaN(miktar) || miktar <= 0) return message.channel.send("Geçerli bir miktar gir.");

        hesap_olustur(userId);
        let data = para_yukle();

        if (data[userId.toString()] < miktar) return message.channel.send("Yeterli paran yok 😈");

        slotCooldowns.set(userId, now);
        // Optional: clear cooldown after it expires to save memory (though Map is fine)
        setTimeout(() => slotCooldowns.delete(userId), cooldownAmount);

        const semboller = ["🍒", "🍋", "💎", "7️⃣"];
        const sonuc = [
            semboller[Math.floor(Math.random() * semboller.length)],
            semboller[Math.floor(Math.random() * semboller.length)],
            semboller[Math.floor(Math.random() * semboller.length)]
        ];
        const sans = Math.floor(Math.random() * 100) + 1;

        let mesaj = "";
        if (sans <= 5) {
            const kazanc = miktar * 4;
            data[message.author.id] += kazanc;
            mesaj = `🎰 ${sonuc.join(' ')}\n💎 JACKPOT! +${kazanc} coin`;
        } else if (sans <= 25) {
            const kazanc = miktar * 2;
            data[message.author.id] += kazanc;
            mesaj = `🎰 ${sonuc.join(' ')}\n🎉 Kazandın! +${kazanc} coin`;
        } else if (sans <= 50) {
            mesaj = `🎰 ${sonuc.join(' ')}\n😐 Berabere! Paran geri.`;
        } else {
            data[message.author.id] -= miktar;
            mesaj = `🎰 ${sonuc.join(' ')}\n💀 Kaybettin! -${miktar} coin`;
        }

        para_kaydet(data);
        message.channel.send(mesaj);
    }

    else if (command === "zenginler") {
        const data = para_yukle();
        const temiz_data = Object.entries(data).filter(([k, v]) => k !== "gunluk_zaman");

        if (temiz_data.length === 0) return message.channel.send("Henüz kimsenin parası yok 😅");

        const sirali = temiz_data.sort((a, b) => b[1] - a[1]).slice(0, 5);

        const embed = new EmbedBuilder()
            .setTitle("🏆 En Zenginler")
            .setColor(0xFFD700);

        for (let i = 0; i < sirali.length; i++) {
            const [userId, para] = sirali[i];
            const user = message.guild.members.cache.get(userId) || await message.guild.members.fetch(userId).catch(() => null);
            if (user) {
                embed.addFields({ name: `${i + 1}. ${user.user.username}`, value: `💰 ${para} coin`, inline: false });
            }
        }

        message.channel.send({ embeds: [embed] });
    }

    else if (command === "paraat" || command === "gönder") {
        const uye = message.mentions.members.first();
        const miktar = parseInt(args[1]);

        if (!uye) return message.reply("❌ Para göndermek istediğin kişiyi etiketle!");
        if (uye.id === message.author.id) return message.reply("❌ Kendine para gönderemezsin!");
        if (isNaN(miktar) || miktar <= 0) return message.reply("❌ Geçerli bir miktar gir!");

        hesap_olustur(message.author.id);
        hesap_olustur(uye.id);

        let data = para_yukle();
        if (data[message.author.id] < miktar) return message.reply("❌ Yeterli paran yok!");

        data[message.author.id] -= miktar;
        data[uye.id] = (data[uye.id] || 0) + miktar;

        para_kaydet(data);
        message.channel.send(`✅ ${message.author}, ${uye} kişisine **${miktar}** coin gönderdi!`);
    }

    else if (command === "blackjack" || command === "bj") {
        const miktar = parseInt(args[0]);
        if (isNaN(miktar) || miktar <= 0) return message.reply("❌ Geçerli bir bahis gir!");

        const userId = message.author.id;
        hesap_olustur(userId);
        let para_data = para_yukle();
        if ((para_data[userId] || 0) < miktar) return message.reply("❌ Yetersiz bakiye!");

        // Parayı baştan düş
        para_data[userId] -= miktar;
        para_kaydet(para_data);

        const deck = createDeck();
        const playerHand = [deck.pop(), deck.pop()];
        const dealerHand = [deck.pop(), deck.pop()];
        const playerScore = getScore(playerHand);

        blackjackGames.set(userId, { deck, playerHand, dealerHand, miktar });

        const embed = new EmbedBuilder()
            .setTitle('🃏 Blackjack')
            .setColor('#2f3136')
            .addFields(
                { name: `Senin Elin (${playerScore})`, value: playerHand.map(c => `${c.value}${c.suit}`).join(' '), inline: true },
                { name: `Kasa Eli (?)`, value: `${dealerHand[0].value}${dealerHand[0].suit} ❓`, inline: true }
            )
            .setFooter({ text: `Bahis: ${miktar} coin` });

        if (playerScore === 21) {
            para_data[userId] += Math.floor(miktar * 2.5);
            para_kaydet(para_data);
            blackjackGames.delete(userId);
            embed.setTitle('🃏 Blackjack - KAZANDIN! 🎉')
                .setDescription(`Müthiş! Blackjack yaptın ve **${Math.floor(miktar * 2.5)}** coin kazandın.`);
            return message.channel.send({ embeds: [embed] });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bj_hit_${userId}`).setLabel('Kart Çek').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`bj_stand_${userId}`).setLabel('Dur').setStyle(ButtonStyle.Secondary)
        );

        message.channel.send({ embeds: [embed], components: [row] });
    }

    else if (command === "mayın" || command === "mines") {
        const bahis = parseInt(args[0]);
        const mayinSayisi = parseInt(args[1]) || 3;
        const userId = message.author.id;

        if (isNaN(bahis) || bahis <= 0) return message.reply("❌ Geçerli bir bahis gir!");
        if (mayinSayisi < 1 || mayinSayisi > 20) return message.reply("❌ Mayın sayısı 1-20 arası olmalı!");

        hesap_olustur(userId);
        let para_data = para_yukle();
        if ((para_data[userId] || 0) < bahis) return message.reply("❌ Yetersiz bakiye!");

        para_data[userId] -= bahis;
        para_kaydet(para_data);

        const mines = [];
        const positions = Array.from({ length: 20 }, (_, i) => i);
        for (let i = 0; i < mayinSayisi; i++) {
            const index = Math.floor(Math.random() * positions.length);
            mines.push(positions.splice(index, 1)[0]);
        }

        minesGames.set(userId, { mines, revealed: [], bahis, mayinSayisi, multiplier: 1, totalTiles: 20 });

        const embed = new EmbedBuilder()
            .setTitle('💣 Mayın Tarlası')
            .setDescription(`**${mayinSayisi}** Mayın var. Kareleri açarak kazancını katla!\n\n💰 Bahis: **${bahis}**\n📈 Çarpan: **1.00x**`)
            .setColor('#f1c40f');

        const rows = [];
        for (let i = 0; i < 4; i++) {
            const row = new ActionRowBuilder();
            for (let j = 0; j < 5; j++) {
                const idx = i * 5 + j;
                row.addComponents(new ButtonBuilder().setCustomId(`mines_reveal_${idx}_${userId}`).setLabel('?').setStyle(ButtonStyle.Secondary));
            }
            rows.push(row);
        }

        const controlRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`mines_cashout_0_${userId}`)
                .setLabel('Parayı Çek (Cashout)')
                .setStyle(ButtonStyle.Success)
                .setDisabled(true)
        );
        rows.push(controlRow);

        message.channel.send({ embeds: [embed], components: rows });
    }

    // ---------------- LEVEL KOMUTU ----------------

    else if (command === "level") {
        const uye = message.mentions.members.first() || message.member;
        const user = uye.user;
        const xpData = xp_yukle();
        const xp = xpData[user.id] || 0;
        const level = Math.floor(Math.sqrt(xp / 300));
        const currentLevelXp = Math.pow(level, 2) * 300;
        const nextLevelXp = Math.pow(level + 1, 2) * 300;
        const xpRequired = nextLevelXp - currentLevelXp;
        const xpCurrent = xp - currentLevelXp;

        const status = uye.presence?.status || "offline";
        const rankCard = await new canvafy.Rank()
            .setAvatar(user.displayAvatarURL({ forceStatic: true, extension: "png" }))
            .setBackground("color", "#23272a")
            .setUsername(user.username)
            .setStatus(status === "invisible" ? "offline" : (status === "dnd" ? "dnd" : (status === "idle" ? "idle" : (status === "online" ? "online" : "offline"))))
            .setLevel(level)
            .setRank(1, "Sıra", false)
            .setCurrentXp(xpCurrent)
            .setRequiredXp(xpRequired)
            .setBarColor("#2ecc71")
            .build();

        const attachment = new AttachmentBuilder(rankCard, { name: `rankcard-${user.id}.png` });
        message.channel.send({ files: [attachment] });
    }

    // ---------------- MÜZİK KOMUTLARI ----------------

    else if (command === "çal") {
        const query = args.join(" ");
        if (!query) return message.channel.send("Bir şarkı adı veya URL gir.");

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.channel.send("Ses kanalına gir.");

        let connection = getVoiceConnection(message.guild.id);
        if (!connection) {
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });
        }

        try {
            // Kuyruğa ekle
            musicQueue.push({ query, message });

            if (musicQueue.length > 1 || player.state.status === AudioPlayerStatus.Playing) {
                return message.channel.send(`✅ **${query}** sıraya eklendi! (Sıradaki: ${musicQueue.length - 1})`);
            }

            await playNext(message);

        } catch (error) {
            console.error("[MÜZİK HATASI]:", error);
            message.channel.send(`❌ Hata oluştu: ${error.message}`);
        }
    }

    else if (command === "geç") {
        if (musicQueue.length === 0) return message.channel.send("Sırada bir şey yok.");

        message.channel.send("⏭️ Şarkı geçiliyor...");
        player.stop(); // Bu Idle listener'ını tetikleyip playNext'i çağırır
    }

    else if (command === "dur") {
        if (player.state.status === AudioPlayerStatus.Playing) {
            player.pause();
            message.channel.send("⏸ Duraklatıldı");
        } else {
            message.channel.send("Zaten bir şey çalmıyor.");
        }
    }

    else if (command === "devam") {
        if (player.state.status === AudioPlayerStatus.Paused) {
            player.unpause();
            message.channel.send("▶️ Devam ediyor");
        } else {
            message.channel.send("Zaten çalıyor veya duraklatılmış bir şarkı yok.");
        }
    }

    else if (command === "çık") {
        const connection = getVoiceConnection(message.guild.id);
        if (connection) {
            connection.destroy();
            musicQueue = []; // Kuyruğu temizle
            isLooping = false;
            message.channel.send("👋 Çıktım ve kuyruk temizlendi.");
        }
    }

    else if (command === "sıra") {
        if (musicQueue.length === 0) return message.channel.send("📭 Kuyruk şu an boş.");

        const embed = new EmbedBuilder()
            .setTitle("🎼 Şarkı Kuyruğu")
            .setColor("#00FF00");

        let liste = "";
        for (let i = 0; i < Math.min(musicQueue.length, 10); i++) {
            liste += `${i === 0 ? "▶️ **Şu an:**" : `**${i}.**`} ${musicQueue[i].query}\n`;
        }

        if (musicQueue.length > 10) liste += `\n*ve ${musicQueue.length - 10} şarkı daha...*`;

        embed.setDescription(liste);
        embed.setFooter({ text: `Döngü: ${isLooping ? "✅ Açık" : "❌ Kapalı"}` });
        message.channel.send({ embeds: [embed] });
    }

    else if (command === "ses") {
        const vol = parseInt(args[0]);
        if (isNaN(vol) || vol < 0 || vol > 100) return message.reply("❌ Lütfen 0-100 arası bir değer gir.");

        if (!currentResource) return message.reply("❌ Şu an bir şey çalmıyor.");

        currentResource.volume.setVolume(vol / 100);
        message.reply(`🔊 Ses seviyesi: **%${vol}**`);
    }

    else if (command === "döngü") {
        isLooping = !isLooping;
        message.reply(`🔄 Döngü modu: **${isLooping ? "Açık (Şu anki şarkı tekrarlanacak)" : "Kapalı"}**`);
    }

    // ---------------- EĞLENCE KOMUTLARI ----------------


    else if (command === "ego") {
        let data = loadJSON('ego.json');
        const guildId = message.guild.id.toString();
        const today = new Date().toISOString().slice(0, 10);

        if (!data[guildId]) data[guildId] = {};

        if (data[guildId].tarih === today) {
            const uyeId = data[guildId].id;
            const uye = message.guild.members.cache.get(uyeId) || await message.guild.members.fetch(uyeId).catch(() => null);
            if (uye) {
                return message.channel.send(`👑 Bugünün en egolusu: ${uye}`);
            }
        }

        const members = message.guild.members.cache;
        const humans = members.filter(m => !m.user.bot);
        if (humans.size === 0) return message.channel.send("Sunucuda yeterli kişi yok 😅");

        const uye = humans.random();

        data[guildId].id = uye.id;
        data[guildId].tarih = today;
        saveJSON('ego.json', data);

        message.channel.send(`👑 Bugünün en egolusu: ${uye}`);
    }

    else if (command === "roast") {
        const uye = message.mentions.members.first();
        if (!uye) return message.channel.send("Birini etiketle 😈");
        message.channel.send(`🔥 ${uye} ${roastlar[Math.floor(Math.random() * roastlar.length)]}`);
    }

    else if (command === "tkm" || command === "taş") {
        const secenekler = ["taş", "kağıt", "makas"];
        const secim = args[0] ? args[0].toLowerCase() : null;

        if (secim === null || !secenekler.includes(secim.toLowerCase())) {
            return message.channel.send("Kullanım: n!tkm taş / kağıt / makas");
        }

        const bot_secim = secenekler[Math.floor(Math.random() * secenekler.length)];
        let sonuc = "";

        if (secim === bot_secim) {
            sonuc = "Berabere!";
        } else if (
            (secim === "taş" && bot_secim === "makas") ||
            (secim === "kağıt" && bot_secim === "taş") ||
            (secim === "makas" && bot_secim === "kağıt")
        ) {
            sonuc = "Kazandın! 🎉";
        } else {
            sonuc = "Kaybettin 😈";
        }

        message.channel.send(`Sen: ${secim} \nBot: ${bot_secim} \nSonuç: ${sonuc}`);
    }


    else if (command === "üye") {
        const guild = message.guild;
        const toplam = guild.memberCount;
        const members = guild.members.cache;

        let online = 0, idle = 0, dnd = 0, offline = 0, bot_sayisi = 0;

        members.forEach(member => {
            if (member.user.bot) bot_sayisi++;
            const status = member.presence?.status || 'offline';
            if (status === 'online') online++;
            else if (status === 'idle') idle++;
            else if (status === 'dnd') dnd++;
            else offline++;
        });

        const embed = new EmbedBuilder()
            .setTitle(`📊 ${guild.name} Üye İstatistikleri`)
            .setColor(0x00FF00)
            .addFields(
                { name: "👥 Toplam Üye", value: toplam.toString(), inline: false },
                { name: "🟢 Çevrimiçi", value: online.toString(), inline: true },
                { name: "🌙 Boşta", value: idle.toString(), inline: true },
                { name: "⛔ Rahatsız Etmeyin", value: dnd.toString(), inline: true },
                { name: "⚫ Çevrimdışı", value: offline.toString(), inline: true },
                { name: "🤖 Bot Sayısı", value: bot_sayisi.toString(), inline: false }
            );

        message.channel.send({ embeds: [embed] });
    }

    else if (command === "sarıl" || command === "op" || command === "tokat") {
        const tag = command === "sarıl" ? "hug" : (command === "op" ? "kiss" : "slap");
        const uye = message.mentions.members.first();
        if (uye && uye.id === message.author.id) {
            if (command === "sarıl") return message.channel.send("Kendine sarılmak mı... gel buraya ben sarılayım 🫂");
        }
        try {
            const resp = await fetch(`https://api.giphy.com/v1/gifs/random?api_key=${GIPHY_API_KEY}&tag=${tag}&rating=pg`);
            const json = await resp.json();
            const gifUrl = json.data.images.original.url;
            let desc = command === "sarıl" ? (uye ? `${message.author}, ${uye} kişisine sarıldı 🤗` : `${message.author} herkese sarıldı 🤗`) : (command === "op" ? (uye ? `${message.author}, ${uye} kişisini öptü 🤗` : `${message.author} herkesi öptü 🤗`) : (uye ? `${message.author}, ${uye} kişisine tokat attı 👋` : `${message.author} herkese tokat attı 👋`));
            const embed = new EmbedBuilder().setDescription(desc).setColor(0xFFC0CB).setImage(gifUrl);
            message.channel.send({ embeds: [embed] });
        } catch (e) {
            message.channel.send("Gif çekilirken hata oluştu.");
        }
    }

    // ---------------- KARAKTERLER ----------------
    else if (command === "karakter") {
        const isim = args.join(" ").toLowerCase();
        if (!isim) return message.channel.send("Lütfen bir karakter ismi gir! (Örn: `n!karakter steve`) ");

        // Önce yerel listeye bak (Özel hikayeler için)
        let karakter = karakterler[isim];

        if (karakter) {
            const embed = new EmbedBuilder()
                .setTitle(`${karakter.ad} (${karakter.oyun})`)
                .setDescription(karakter.hikaye)
                .setColor(karakter.renk || "#3498db")
                .setThumbnail(karakter.resim)
                .setFooter({ text: "Özel Bilgi | Nexora Bot" });

            return message.channel.send({ embeds: [embed] });
        }

        // Yerelde yoksa Wikipedia (TR ve EN) üzerinden ara
        try {
            // Önce Türkçe Wikipedia'yı dene
            let wikiUrl = `https://tr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(isim)}`;
            let resp = await fetch(wikiUrl);
            let data = await resp.json();

            // Bulunamazsa İngilizce Wikipedia'yı dene
            if (data.type === 'disambiguation' || data.status === 404) {
                wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(isim)}`;
                resp = await fetch(wikiUrl);
                data = await resp.json();
            }

            if (data.title && data.extract && data.type !== 'disambiguation' && data.status !== 404) {
                const embed = new EmbedBuilder()
                    .setTitle(`${data.title}`)
                    .setDescription(data.extract.length > 1000 ? data.extract.substring(0, 1000) + "..." : data.extract)
                    .setColor("#3498db")
                    .setThumbnail(data.thumbnail ? data.thumbnail.source : null)
                    .setFooter({ text: "Kaynak: Wikipedia | Nexora Bot" });

                if (data.content_urls && data.content_urls.desktop) {
                    embed.addFields({ name: "Devamını Oku", value: `[Wikipedia Linki](${data.content_urls.desktop.page})` });
                }

                message.channel.send({ embeds: [embed] });
            } else {
                message.channel.send("❌ Bu karakter hakkında bilgi bulamadım. Belki ismini tam yazman gerekebilir veya henüz Wikipedia'da sayfası yoktur.");
            }
        } catch (e) {
            console.error("Wiki Hatası:", e);
            message.channel.send("❌ Bilgi aranırken bir hata oluştu.");
        }
    }

    else if (command === "pp") {
        const uye = message.mentions.members.first() || message.member;
        const user = uye.user;

        const profile = await new canvafy.WelcomeLeave()
            .setAvatar(user.displayAvatarURL({ forceStatic: true, extension: "png" }))
            .setBackground("color", "#2f3136")
            .setTitle(user.username.substring(0, 20))
            .setDescription("Nexora Kullanıcı Profili".substring(0, 80))
            .setBorder("#2ecc71")
            .setAvatarBorder("#2ecc71")
            .build();

        const attachment = new AttachmentBuilder(profile, { name: `profile-${user.id}.png` });
        message.channel.send({ files: [attachment] });
    }

    else if (command === "yardım") {
        const embed = new EmbedBuilder()
            .setTitle("📜 Bot Komutları")
            .setDescription("Komutları kullanmak için `n!<komut>` veya `/<komut>` yazabilirsin. 👇")
            .setColor(0x0000FF)
            .addFields(
                { name: "💰 Ekonomi", value: "`n!bakiye` - Bakiyeni gösterir\n`n!gunluk` - Günlük para alırsın\n`n!slot <miktar>` - Slot oynarsın\n`n!zenginler` - En zenginleri gösterir\n`n!paraat @kişi <miktar>` - Para gönderirsin\n`n!market` - Eşya fiyatlarını görürsün\n`n!satınal <ürün> <miktar>` - Eşya alırsın\n`n!sat <ürün> <miktar>` - Eşya satarsın\n`n!envanter` - Eşyalarını görürsün\n`n!sans` - Günlük şansını ölçer\n`n!tahmin <sayı>` - Sayı tahmin oyunu", inline: false },
                { name: "📈 Level Sistemi", value: "`n!level` - Seviyeni ve XP'ni gösterir (Görsel Kart)", inline: false },
                { name: "🃏 Kumar Oyunları", value: "`n!blackjack <bahis>` veya `/blackjack` - 21 Oynarsın\n`n!mayın <bahis> <mayın_sayısı>` veya `/mayın` - Mayın tarlası oynarsın", inline: false },
                { name: "🎮 Eğlence & Müzik", value: "`nex <herhangi bir şey>` - Yapay zeka (Gemini AI) ile sohbet\n`n!karakter <isim>` - Karakter hikayeleri (Wikipedia destekli)\n`n!çal <şarkı>` - Müzik çalar\n`n!geç` - Şarkıyı geçer\n`n!dur`/`n!devam` - Müziği yönetir\n`n!sıra` - Kuyruğu gösterir\n`n!ses <0-100>` - Ses seviyesini ayarlar\n`n!döngü` - Şarkıyı tekrarlar\n`n!çık` - Ses kanalından çıkar\n`n!ego` - Kim egolu seçer\n`n!roast @kişi` - Laf sokar\n`n!taş` - TKM oynarsın\n`n!sarıl`/`n!op`/`n!tokat` - Gif atar\n`n!pp @kişi` - Avatarını gösterir (Görsel Kart)\n`n!üye` - Sunucu istatistikleri", inline: false }
            )
            .setFooter({ text: "NEXORA BOT | Tüm Sistemler Aktif" });
        message.channel.send({ embeds: [embed] });
    }


    // ---------------- YENİ EKONOMİ KOMUTLARI (MARKET, SATINAL, SAT, ŞANS, TAHMİN, ENVANTER) ----------------

    else if (command === "market") {
        const p_data = p_loadData();
        p_updateMarket(p_data);
        const embed = new EmbedBuilder()
            .setTitle("🏪 NEXORA GLOBAL MARKET")
            .setColor("#f1c40f")
            .setDescription("Lütfen satın almak istediğiniz ürünü aşağıdaki menüden seçin.")
            .setFooter({ text: "Fiyatlar saatlik olarak güncellenir." });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('market_select')
            .setPlaceholder('Bir ürün seçin...')
            .addOptions(
                Object.keys(p_data.market).map(item => ({
                    label: item.toUpperCase().replace("_", " "),
                    description: `Fiyat: ${p_data.market[item]} Coin | Değişim: ${p_data.marketChanges[item] || "0%"}`,
                    value: item,
                    emoji: "📦"
                }))
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        for (const item in p_data.market) {
            embed.addFields({
                name: item.toUpperCase().replace("_", " "),
                value: `💰 **${p_data.market[item]}** Coin\n💹 **${p_data.marketChanges[item] || "0%"}**`,
                inline: true
            });
        }

        message.reply({ embeds: [embed], components: [row] });
    }

    else if (command === "satınal") {
        const itemName = args[0]?.toLowerCase();
        const amount = parseInt(args[1]) || 1;
        const p_data = p_loadData(); // Eklendi
        if (!itemName || !p_data.market[itemName]) return message.reply("❌ Geçersiz ürün!");
        if (isNaN(amount) || amount <= 0) return message.reply("❌ Geçersiz miktar!");

        const para_data = para_yukle(); // Eklendi
        const userPara = para_data[message.author.id] || 0; // Eklendi
        const totalPrice = p_data.market[itemName] * amount;

        if (userPara < totalPrice) return message.reply(`❌ Yetersiz bakiye! Gerekli: ${totalPrice}`);

        para_data[message.author.id] -= totalPrice;
        para_kaydet(para_data);

        p_checkUser(p_data, message.author.id); // Eklendi
        p_data.users[message.author.id].items[itemName] = (p_data.users[message.author.id].items[itemName] || 0) + amount;
        p_saveData(p_data);

        message.reply(`✅ **${amount} adet ${itemName}** satın alındı!`);
    }

    else if (command === "sat") {
        const itemName = args[0]?.toLowerCase();
        const amount = parseInt(args[1]) || 1;
        const p_data = p_loadData(); // Eklendi
        p_checkUser(p_data, message.author.id); // Eklendi
        const p_user = p_data.users[message.author.id]; // Eklendi

        if (!itemName || !p_data.market[itemName]) return message.reply("❌ Geçersiz ürün!");
        if (isNaN(amount) || amount <= 0) return message.reply("❌ Geçersiz miktar!");
        if (!p_user.items[itemName] || p_user.items[itemName] < amount) return message.reply("❌ Yeterli ürünün yok!");

        const totalPrice = p_data.market[itemName] * amount;
        const para_data = para_yukle(); // Eklendi
        para_data[message.author.id] = (para_data[message.author.id] || 0) + totalPrice;
        para_kaydet(para_data);

        p_user.items[itemName] -= amount;
        p_saveData(p_data);

        message.reply(`💰 **${amount} adet ${itemName}** satıldı! Kazanılan: ${totalPrice}`);
    }

    else if (command === "sans") {
        const p_data = p_loadData(); // Eklendi
        p_checkUser(p_data, message.author.id); // Eklendi
        const p_user = p_data.users[message.author.id]; // Eklendi
        const now = Date.now();
        if (now - p_user.lastLuckUse < 86400000) {
            const rem = 86400000 - (now - p_user.lastLuckUse);
            return message.reply(`⏳ Beklemelisin: ${Math.floor(rem / 3600000)}sa ${Math.floor((rem % 3600000) / 60000)}dk`);
        }
        p_user.dailyLuck = Math.floor(Math.random() * 100) + 1;
        p_user.lastLuckUse = now;
        p_saveData(p_data);
        message.reply(`Bugünkü şansın %${p_user.dailyLuck} 🍀`);
    }

    else if (command === "tahmin") {
        const p_data = p_loadData(); // Eklendi
        p_checkUser(p_data, message.author.id); // Eklendi
        const p_user = p_data.users[message.author.id]; // Eklendi
        const now = Date.now();
        if (now - p_user.lastLuckUse >= 86400000 || p_user.lastLuckUse === 0) return message.reply("❌ Önce `n!sans` kullanmalısın.");

        const today = new Date().setHours(0, 0, 0, 0);
        if (p_user.lastTahminReset < today) {
            p_user.tahminCount = 0;
            p_user.lastTahminReset = today;
        }

        if (p_user.tahminCount >= 2) {
            return message.reply("❌ Bugünkü tahmin haklarını bitirdin!");
        }

        const guess = parseInt(args[0]);
        if (isNaN(guess) || guess < 1 || guess > 10) return message.reply("❌ 1-10 arası bir sayı gir.");

        // Hak düş ve kaydet
        p_user.tahminCount++;
        p_saveData(p_data);

        const botNum = Math.floor(Math.random() * 10) + 1;
        if (guess === botNum) {
            let gift = p_user.dailyLuck <= 50 ? "tuvalet_kagidi" : (p_user.dailyLuck <= 75 ? "altin" : (p_user.dailyLuck <= 90 ? "yakut" : "elmas"));
            p_user.items[gift] = (p_user.items[gift] || 0) + 1;
            p_saveData(p_data);
            message.reply(`🎯 DOĞRU! Sayı ${botNum} idi. Ödülün: 1x ${gift.toUpperCase()}\n(Kalan hak: ${2 - p_user.tahminCount})`);
        } else {
            message.reply(` Maalesef yanlış! Doğru sayı: ${botNum}\n(Kalan hak: ${2 - p_user.tahminCount})`);
        }
    }

    else if (command === "envanter") {
        const p_data = p_loadData(); // Eklendi
        p_checkUser(p_data, message.author.id); // Eklendi
        const p_user = p_data.users[message.author.id]; // Eklendi
        const para_data = para_yukle(); // Eklendi
        const userPara = para_data[message.author.id] || 0; // Eklendi
        let txt = `💰 Bakiyen: **${userPara}**\n\n📦 **Eşyaların:**\n`;
        for (const item in p_user.items) if (p_user.items[item] > 0) txt += `• ${item.toUpperCase().replace("_", " ")}: ${p_user.items[item]}\n`;
        const embed = new EmbedBuilder().setTitle(`🎒 ${message.author.username} Envanteri`).setDescription(txt || "Boş").setColor("#3498db");
        message.reply({ embeds: [embed] });
    }

    else {
        // Sadece "nex " prefixi ile AI çalışsın
        if (prefix !== "nex ") return;

        const soru = [command, ...args].join(" ").trim();
        if (!soru || soru.length < 2) return;

        // Cooldown Kontrolü (10 saniye)
        const now = Date.now();
        const cooldownAmount = 10000;
        if (aiCooldowns.has(message.author.id)) {
            const expirationTime = aiCooldowns.get(message.author.id) + cooldownAmount;
            if (now < expirationTime) {
                const timeLeft = (expirationTime - now) / 1000;
                return message.reply(`⏳ Çok hızlı soruyorsun! ${timeLeft.toFixed(1)} saniye sonra tekrar deneyebilirsin.`);
            }
        }
        aiCooldowns.set(message.author.id, now);

        console.log(`[Gemini] Soru geldi: ${soru}`);
        const loadingMsg = await message.channel.send("🤔 Düşünüyorum...");

        try {
            const prompt = `Sen Nexora Bot'un yapay zeka asistanısın. Kısa ve öz cevap ver. Soru: ${soru}`;

            const startIndex = lastWorkingModelIndex;
            const tryOrder = [...MODELS_TO_TRY.slice(startIndex), ...MODELS_TO_TRY.slice(0, startIndex)];

            let success = false;
            let lastError = "";

            for (const currentModel of tryOrder) {
                try {
                    console.log(`[AI] Deneniyor: ${currentModel.name}`);
                    const fetchResp = await fetch(`https://generativelanguage.googleapis.com/${currentModel.version}/models/${currentModel.name}:generateContent?key=${GEMINI_API_KEY}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                    });

                    if (!fetchResp.ok) {
                        const errData = await fetchResp.json().catch(() => ({}));
                        lastError = errData.error?.message || `Sunucu hatası (${fetchResp.status})`;
                        console.warn(`[AI] ${currentModel.name} başarısız: ${lastError}`);
                        continue; // Diğer modele geç
                    }

                    const data = await fetchResp.json();

                    if (data.candidates && data.candidates[0].content.parts && data.candidates[0].content.parts[0].text) {
                        const responseText = data.candidates[0].content.parts[0].text;
                        await loadingMsg.edit(responseText.length > 2000 ? responseText.substring(0, 1997) + "..." : responseText);
                        lastWorkingModelIndex = MODELS_TO_TRY.findIndex(m => m.name === currentModel.name);
                        success = true;
                        break;
                    } else if (data.error) {
                        lastError = data.error.message;
                        console.warn(`[AI] ${currentModel.name} hatası: ${lastError}`);
                    }
                } catch (err) {
                    lastError = "Bağlantı hatası.";
                    console.error(`[AI] ${currentModel.name} bağlantı hatası:`, err.message);
                }
            }

            if (!success) {
                let errorMessage = lastError || "Gemini'dan yanıt alınamadı.";
                if (errorMessage.includes("quota")) errorMessage = "Google API kotan dolmuş. Lütfen biraz bekle.";
                await loadingMsg.edit(`❌ ${errorMessage}`);
            }

        } catch (error) {
            console.error("Gemini Genel Hata:", error.message);
            await loadingMsg.edit(`❌ Bir sorun oluştu: ${error.message}`);
        }
    }
});

console.log("-----------------------------------------");
console.log("Discord'a bağlanma süreci başlatıldı...");

client.login(TOKEN).catch(err => {
    console.error("❌ Discord'a bağlanırken hata oluştu:");
    console.error(err);
});

client.on("ready", () => {
    console.log(`🚀 BOT RESMEN AKTİF: ${client.user.tag}`);
    console.log("-----------------------------------------");
});

// ---------------- GRACEFUL SHUTDOWN (KAPATMA) ----------------
const handleShutdown = async (signal) => {
    console.log(`\nSinyal alındı: ${signal}. Bot kapatılıyor...`);

    if (STATUS_CHANNEL_ID) {
        try {
            const channel = await client.channels.fetch(STATUS_CHANNEL_ID).catch(() => null);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle("🔴 Bot Çevrimdışı")
                    .setDescription("Nexora Bot şu an çevrimdışı. Geri döneceğiz!")
                    .setColor("#ff4444")
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
            }
        } catch (e) {
            console.error("Kapanış mesajı gönderilemedi:", e);
        }
    }

    client.destroy();
    process.exit(0);
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
