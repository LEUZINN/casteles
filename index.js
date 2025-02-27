require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, REST, Routes } = require("discord.js");
const axios = require("axios");

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
});

const API_KEY = process.env.SMS24H_API_KEY;
const BASE_URL = "https://api.sms24h.org/stubs/handler_api";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID; // ID do seu bot

const cooldowns = new Map();
const userNumbers = new Map();

const COOLDOWN_TIME = 5 * 60 * 1000; // 5 minutos
const CHECK_INTERVAL = 10 * 1000; // 10 segundos

// Função para definir o status
function setStatus(status) {
    client.user.setPresence({
        activities: [{ name: status, type: ActivityType.Watching }],
        status: "dnd", // Modo Não Perturbe enquanto gera números
    });
}

// Função para gerar um número
async function gerarNumero(user) {
    if (cooldowns.has(user.id)) {
        const tempoRestante = (cooldowns.get(user.id) - Date.now()) / 1000;
        return { erro: `⏳ Aguarde **${Math.ceil(tempoRestante)}s** antes de gerar outro número.` };
    }

    if (userNumbers.has(user.id)) {
        return { erro: "⚠️ Você já tem um número ativo. Aguarde o código SMS." };
    }

    try {
        setStatus("Gerando números...");

        const url = `${BASE_URL}?api_key=${API_KEY}&action=getNumber&service=ds&country=73`;
        const response = await axios.get(url);

        if (response.data.startsWith("ACCESS_NUMBER")) {
            const partes = response.data.split(":");
            const numeroInfo = { id: partes[1], numero: partes[2], user };

            userNumbers.set(user.id, numeroInfo);
            cooldowns.set(user.id, Date.now() + COOLDOWN_TIME);
            setTimeout(() => cooldowns.delete(user.id), COOLDOWN_TIME);

            const embed = new EmbedBuilder()
                .setTitle("📞 Número Gerado")
                .setDescription(`Seu número foi gerado com sucesso! O bot irá monitorar o SMS automaticamente.`)
                .addFields(
                    { name: "📲 Número", value: `**${numeroInfo.numero}**`, inline: true },
                    { name: "🆔 ID", value: `\`${numeroInfo.id}\``, inline: true }
                )
                .setColor("#00ff00")
                .setFooter({ text: "Aguarde, o código será enviado assim que chegar!" });

            try {
                await user.send({ embeds: [embed] });
                monitorarSms(numeroInfo);
                return { sucesso: true };
            } catch (error) {
                userNumbers.delete(user.id);
                return { erro: "⚠️ Não foi possível enviar DM. Ative as mensagens diretas!" };
            }
        } else {
            return { erro: "❌ Falha ao obter número: " + response.data };
        }
    } catch (error) {
        return { erro: "❌ Erro ao conectar à API" };
    } finally {
        setStatus("Online");
    }
}

// Função para monitorar SMS automaticamente
async function monitorarSms(numeroInfo) {
    const { id, user } = numeroInfo;

    const intervalo = setInterval(async () => {
        if (!userNumbers.has(user.id)) {
            clearInterval(intervalo);
            return;
        }

        try {
            const url = `${BASE_URL}?api_key=${API_KEY}&action=getStatus&id=${id}`;
            const response = await axios.get(url);
            const status = response.data;

            if (status.startsWith("STATUS_OK")) {
                const codigo = status.split(":")[1];
                const embed = new EmbedBuilder()
                    .setTitle("📩 Código Recebido")
                    .setDescription(`Seu código chegou!`)
                    .addFields(
                        { name: "🔢 Código", value: `**${codigo}**`, inline: true },
                        { name: "🆔 ID", value: `\`${id}\``, inline: true }
                    )
                    .setColor("#00ff00");

                await user.send({ embeds: [embed] });
                userNumbers.delete(user.id);
                clearInterval(intervalo);
            } else if (status.startsWith("STATUS_CANCEL")) {
                const embed = new EmbedBuilder()
                    .setTitle("❌ Ativação Cancelada")
                    .setDescription("A ativação foi cancelada pela API.")
                    .setColor("#ff0000");

                await user.send({ embeds: [embed] });
                userNumbers.delete(user.id);
                clearInterval(intervalo);
            }
        } catch (error) {
            console.log(`Erro ao verificar SMS para ${user.id}:`, error);
        }
    }, CHECK_INTERVAL);
}

// Evento quando o bot estiver pronto
client.once("ready", async () => {
    console.log(`✅ Bot ${client.user.tag} online!`);
    setStatus("Ixtuprando crianças");

    // Registrar o comando /gerar
    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
    try {
        console.log("🔄 Registrando comandos de slash...");
        await rest.put(Routes.applicationCommands(CLIENT_ID), {
            body: [
                {
                    name: "gerar",
                    description: "Gera um número brasileiro para verificação no Discord.",
                },
            ],
        });
        console.log("✅ Comandos de slash registrados com sucesso!");
    } catch (error) {
        console.error("❌ Erro ao registrar comandos de slash:", error);
    }
});

// Evento de interação com o comando de slash
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "gerar") {
        await interaction.deferReply({ ephemeral: true }); // Responde apenas para o usuário
        const resultado = await gerarNumero(interaction.user);

        if (resultado?.erro) {
            await interaction.editReply(resultado.erro);
        } else {
            await interaction.editReply("📩 O número foi enviado na sua DM!");
        }
    }
});

// Iniciar o bot
client.login(DISCORD_TOKEN);