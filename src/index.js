require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  ChannelType
} = require("discord.js");

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "..", "data", "shop.db");

// Créer le dossier data s'il n'existe pas
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const db = new Database(dbPath);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const adminIds = (process.env.BOT_OWNER_ID || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const staffIds = [
  ...new Set(
    (process.env.STAFF_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .concat(adminIds)
  )
];

function isAuthorized(userId) {
  return adminIds.includes(userId) || staffIds.includes(userId);
}

function getPaypalLink() {
  return process.env.PAYPAL_LINK || "https://paypal.me/tonpseudo";
}

function formatMoney(amount) {
  return `${amount} €`;
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price INTEGER NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL,
      image TEXT,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      total INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      paid_at TEXT,
      delivered_at TEXT,
      payment_link TEXT
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const paypalRow = db.prepare("SELECT value FROM config WHERE key = 'paypal_link'").get();
  if (!paypalRow) {
    db.prepare("INSERT INTO config (key, value) VALUES ('paypal_link', ?)").run(getPaypalLink());
  } else {
    db.prepare("UPDATE config SET value = ? WHERE key = 'paypal_link'").run(getPaypalLink());
  }
}

function ensureDefaultProducts() {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM items").get().count;
  if (existing > 0) return;

  const initialItems = [
    {
      item_id: "discord-01",
      name: "Décoration de profil premium",
      description: "Palette élégante et discrète pour personnaliser votre profil Discord.",
      price: 5,
      stock: 20,
      category: "Discord",
      image: "https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?auto=format&fit=crop&w=900&q=80"
    },
    {
      item_id: "discord-02",
      name: "Badge Discord officiel",
      description: "Badge numérique autorisé pour décoration de profil.",
      price: 8,
      stock: 15,
      category: "Discord",
      image: "https://images.unsplash.com/photo-1611162616273-7b269f3f0f2e?auto=format&fit=crop&w=900&q=80"
    },
    {
      item_id: "nitro-01",
      name: "Nitro 1 mois",
      description: "Offre Nitro 1 mois, à utiliser selon les conditions de la plateforme.",
      price: 12,
      stock: 10,
      category: "Nitro",
      image: "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=900&q=80"
    },
    {
      item_id: "nitro-02",
      name: "Nitro 3 mois",
      description: "Offre Nitro 3 mois, selon les conditions d'utilisation autorisées.",
      price: 28,
      stock: 8,
      category: "Nitro",
      image: "https://images.unsplash.com/photo-1526379095098-d400fd0bf935?auto=format&fit=crop&w=900&q=80"
    },
    {
      item_id: "roblox-01",
      name: "500 Robux",
      description: "Paquet Robux standard, uniquement pour ventes autorisées.",
      price: 10,
      stock: 25,
      category: "Roblox",
      image: "https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=900&q=80"
    },
    {
      item_id: "roblox-02",
      name: "1000 Robux",
      description: "Paquet Robux moyen pour les joueurs.",
      price: 18,
      stock: 18,
      category: "Roblox",
      image: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=900&q=80"
    },
    {
      item_id: "other-01",
      name: "Pack personnalisé",
      description: "Produit optionnel à personnaliser selon votre besoin.",
      price: 25,
      stock: 5,
      category: "Autres",
      image: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=80"
    }
  ];

  const insert = db.prepare(`
    INSERT INTO items (item_id, name, description, price, stock, category, image, enabled)
    VALUES (@item_id, @name, @description, @price, @stock, @category, @image, 1)
  `);

  const transaction = db.transaction((products) => {
    for (const product of products) insert.run(product);
  });

  transaction(initialItems);
}

function getCategoryItems(category) {
  return db
    .prepare(
      "SELECT * FROM items WHERE category = ? AND enabled = 1 ORDER BY price ASC"
    )
    .all(category);
}

function getItemByName(name) {
  const lowerName = name.trim().toLowerCase();
  return db
    .prepare(
      `SELECT * FROM items WHERE enabled = 1 AND lower(name) = ?`
    )
    .get(lowerName);
}

function createOrderId() {
  return `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function getOrderById(orderId) {
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
}

function buildShopMenu() {
  const categories = ["Discord", "Nitro", "Roblox", "Autres"];
  const menu = new StringSelectMenuBuilder()
    .setCustomId("shop_category")
    .setPlaceholder("Choisis une catégorie")
    .addOptions(
      categories.map((category) => ({
        label: category,
        value: category,
        description: `Voir les produits ${category.toLowerCase()}`
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

function buildButtonsForProducts(items) {
  const rows = [];
  let row = new ActionRowBuilder();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const button = new ButtonBuilder()
      .setCustomId(`buy_${item.item_id}`)
      .setLabel(`${item.name}`)
      .setStyle(ButtonStyle.Success);

    row.addComponents(button);

    if ((i + 1) % 2 === 0 || i === items.length - 1) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
  }

  return rows;
}

async function sendShopEmbed(interaction) {
  const categories = ["Discord", "Nitro", "Roblox", "Autres"];
  const embed = new EmbedBuilder()
    .setTitle("🛍️ Boutique SHOP")
    .setDescription(
      "Choisis une catégorie pour voir les produits disponibles.\n\n" +
      "⚠️ Les achats sont à confirmer par le propriétaire après vérification du paiement réel."
    )
    .setColor(0x00b894)
    .setThumbnail(
      "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80"
    )
    .addFields(
      categories.map((category) => ({
        name: `• ${category}`,
        value: "Produits disponibles",
        inline: true
      }))
    );

  await interaction.reply({
    embeds: [embed],
    components: [buildShopMenu()]
  });
}

async function showProductsForCategory(interaction, category) {
  const items = getCategoryItems(category);

  if (!items.length) {
    const embed = new EmbedBuilder()
      .setTitle(`📦 ${category}`)
      .setDescription("Aucun produit disponible pour le moment.")
      .setColor(0xff7675);

    return interaction.reply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle(`📦 ${category}`)
    .setDescription("Voici les produits disponibles :")
    .setColor(0x6c5ce7);

  for (const item of items) {
    embed.addFields({
      name: `${item.name} • ${formatMoney(item.price)} • Stock: ${item.stock}`,
      value: `${item.description || "Aucune description"}`
    });
  }

  const buttons = buildButtonsForProducts(items);
  await interaction.reply({
    embeds: [embed],
    components: buttons.length ? buttons : []
  });
}

async function ensureInStockAndNotDuplicate(userId, product) {
  const pendingExisting = db
    .prepare(
      `SELECT * FROM orders
       WHERE user_id = ? AND product_id = ? AND status IN ('pending', 'paid', 'processing')`
    )
    .get(userId, product.item_id);

  if (pendingExisting) {
    throw new Error(
      `Tu as déjà une commande active pour "${product.name}". Attends sa validation ou contacte le support.`
    );
  }

  if (product.stock <= 0) {
    throw new Error(`Le produit "${product.name}" est actuellement en rupture de stock.`);
  }
}

async function handleBuy(interaction) {
  const productName = interaction.options.getString("product");
  const quantity = interaction.options.getInteger("quantity") || 1;

  if (quantity < 1 || quantity > 99) {
    return interaction.reply({
      content: "❌ La quantité doit être comprise entre 1 et 99.",
      ephemeral: true
    });
  }

  const product = getItemByName(productName);

  if (!product) {
    return interaction.reply({
      content: "❌ Produit introuvable. Vérifie le nom exact.",
      ephemeral: true
    });
  }

  try {
    await ensureInStockAndNotDuplicate(interaction.user.id, product);

    if (product.stock < quantity) {
      return interaction.reply({
        content: `❌ Stock insuffisant. Il reste seulement ${product.stock} exemplaire(s).`,
        ephemeral: true
      });
    }

    const orderId = createOrderId();
    const total = product.price * quantity;

    const insertOrder = db.prepare(`
      INSERT INTO orders (
        id, user_id, product_id, product_name, quantity, total, status, created_at, payment_link
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `);

    insertOrder.run(
      orderId,
      interaction.user.id,
      product.item_id,
      product.name,
      quantity,
      total,
      new Date().toISOString(),
      getPaypalLink()
    );

    const embed = new EmbedBuilder()
      .setTitle("✅ Commande créée")
      .setDescription(
        `Votre commande a bien été enregistrée.\n\n` +
        `ID: \`${orderId}\`\n` +
        `Produit: **${product.name}**\n` +
        `Quantité: **${quantity}**\n` +
        `Total: **${formatMoney(total)}**\n\n` +
        `Paiement à effectuer ici : ${getPaypalLink()}\n\n` +
        `⚠️ Le paiement doit être vérifié manuellement par le staff avant validation.`
      )
      .setColor(0x2ecc71)
      .setThumbnail(product.image || null);

    const payButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(getPaypalLink())
      .setLabel("Payer via PayPal");

    const row = new ActionRowBuilder().addComponents(payButton);

    await interaction.reply({
      embeds: [embed],
      components: [row]
    });

    const logEmbed = new EmbedBuilder()
      .setTitle("🧾 Nouvelle commande")
      .setDescription(
        `Utilisateur: <@${interaction.user.id}>\n` +
        `Commande: ${orderId}\n` +
        `Produit: ${product.name}\n` +
        `Total: ${formatMoney(total)}`
      )
      .setColor(0xf1c40f);

    const logChannelId = process.env.LOG_CHANNEL_ID;
    if (logChannelId) {
      const logChannel = interaction.guild.channels.cache.get(logChannelId);
      if (logChannel) logChannel.send({ embeds: [logEmbed] });
    }
  } catch (error) {
    return interaction.reply({
      content: `❌ ${error.message}`,
      ephemeral: true
    });
  }
}

async function handlePaid(interaction) {
  if (!isAuthorized(interaction.user.id)) {
    return interaction.reply({
      content: "❌ Tu n'as pas les permissions pour utiliser cette commande.",
      ephemeral: true
    });
  }

  const orderId = interaction.options.getString("order_id");
  const order = getOrderById(orderId);

  if (!order) {
    return interaction.reply({
      content: "❌ Commande introuvable.",
      ephemeral: true
    });
  }

  if (order.status === "paid") {
    return interaction.reply({
      content: "⚠️ Cette commande est déjà marquée comme payée.",
      ephemeral: true
    });
  }

  db.prepare(`
    UPDATE orders
    SET status = 'paid', paid_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), orderId);

  const product = db.prepare("SELECT * FROM items WHERE item_id = ?").get(order.product_id);
  if (product) {
    db.prepare(`UPDATE items SET stock = stock - ? WHERE item_id = ?`).run(order.quantity, order.product_id);
  }

  return interaction.reply({
    content: `✅ Commande \`${orderId}\` marquée comme payée.`,
    ephemeral: false
  });
}

async function handleDeliver(interaction) {
  if (!isAuthorized(interaction.user.id)) {
    return interaction.reply({
      content: "❌ Tu n'as pas les permissions pour utiliser cette commande.",
      ephemeral: true
    });
  }

  const orderId = interaction.options.getString("order_id");
  const order = getOrderById(orderId);

  if (!order) {
    return interaction.reply({
      content: "❌ Commande introuvable.",
      ephemeral: true
    });
  }

  if (order.status === "delivered") {
    return interaction.reply({
      content: "⚠️ Cette commande est déjà livrée.",
      ephemeral: true
    });
  }

  db.prepare(`
    UPDATE orders
    SET status = 'delivered', delivered_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), orderId);

  return interaction.reply({
    content: `✅ Commande \`${orderId}\` marquée comme livrée.`,
    ephemeral: false
  });
}

async function handleAddItem(interaction) {
  if (!isAuthorized(interaction.user.id)) {
    return interaction.reply({
      content: "❌ Tu n'as pas les permissions pour ajouter un produit.",
      ephemeral: true
    });
  }

  const name = interaction.options.getString("name");
  const description = interaction.options.getString("description");
  const price = interaction.options.getInteger("price");
  const stock = interaction.options.getInteger("stock");
  const category = interaction.options.getString("category");
  const image = interaction.options.getString("image") || "";

  const itemId = `${category.toLowerCase().replace(/\\s+/g, "-")}-${Date.now()}`;

  db.prepare(`
    INSERT INTO items (item_id, name, description, price, stock, category, image, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(itemId, name, description, price, stock, category, image);

  return interaction.reply({
    content: `✅ Produit ajouté : **${name}**`,
    ephemeral: false
  });
}

async function handleRemoveItem(interaction) {
  if (!isAuthorized(interaction.user.id)) {
    return interaction.reply({
      content: "❌ Tu n'as pas les permissions pour supprimer un produit.",
      ephemeral: true
    });
  }

  const name = interaction.options.getString("name");
  const product = getItemByName(name);

  if (!product) {
    return interaction.reply({
      content: "❌ Produit introuvable.",
      ephemeral: true
    });
  }

  db.prepare(`UPDATE items SET enabled = 0 WHERE item_id = ?`).run(product.item_id);

  return interaction.reply({
    content: `✅ Produit désactivé : **${product.name}**`,
    ephemeral: false
  });
}

async function handleSetPrice(interaction) {
  if (!isAuthorized(interaction.user.id)) {
    return interaction.reply({
      content: "❌ Tu n'as pas les permissions.",
      ephemeral: true
    });
  }

  const name = interaction.options.getString("name");
  const price = interaction.options.getInteger("price");
  const product = getItemByName(name);

  if (!product) {
    return interaction.reply({
      content: "❌ Produit introuvable.",
      ephemeral: true
    });
  }

  db.prepare(`UPDATE items SET price = ? WHERE item_id = ?`).run(price, product.item_id);

  return interaction.reply({
    content: `✅ Nouveau prix pour **${product.name}** : ${formatMoney(price)}`,
    ephemeral: false
  });
}

async function handleStock(interaction) {
  if (!isAuthorized(interaction.user.id)) {
    return interaction.reply({
      content: "❌ Tu n'as pas les permissions.",
      ephemeral: true
    });
  }

  const name = interaction.options.getString("name");
  const quantity = interaction.options.getInteger("quantity");
  const product = getItemByName(name);

  if (!product) {
    return interaction.reply({
      content: "❌ Produit introuvable.",
      ephemeral: true
    });
  }

  const newStock = Math.max(0, quantity);
  db.prepare(`UPDATE items SET stock = ? WHERE item_id = ?`).run(newStock, product.item_id);

  return interaction.reply({
    content: `✅ Stock mis à jour pour **${product.name}** : ${newStock}`,
    ephemeral: false
  });
}

async function handleTicket(interaction) {
  const action = interaction.options.getString("action");
  const guild = interaction.guild;

  if (!guild) {
    return interaction.reply({
      content: "❌ Cette commande doit être utilisée dans un serveur Discord.",
      ephemeral: true
    });
  }

  if (action === "open") {
    const categoryId = process.env.TICKET_CATEGORY_ID;

    const channel = await guild.channels.create({
      name: `ticket-${interaction.user.username.toLowerCase()}`,
      type: ChannelType.GuildText,
      parent: categoryId || undefined,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory
          ]
        }
      ]
    });

    const ticketId = `TICKET-${Date.now()}`;
    db.prepare(`
      INSERT INTO tickets (id, user_id, guild_id, channel_id, status, created_at)
      VALUES (?, ?, ?, ?, 'open', ?)
    `).run(ticketId, interaction.user.id, guild.id, channel.id, new Date().toISOString());

    await channel.send({
      content: `Bonjour <@${interaction.user.id}>,\n\nVotre ticket a bien été créé. Expliquez votre demande ici. Un membre du staff vous répondra bientôt.`
    });

    return interaction.reply({
      content: `✅ Ticket créé : <#${channel.id}>`,
      ephemeral: false
    });
  }

  if (action === "close") {
    const userTickets = db.prepare("SELECT * FROM tickets WHERE user_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1").get(interaction.user.id);

    if (!userTickets) {
      return interaction.reply({
        content: "❌ Tu n'as pas de ticket ouvert.",
        ephemeral: true
      });
    }

    const ticketChannel = interaction.guild.channels.cache.get(userTickets.channel_id);
    if (ticketChannel) {
      await ticketChannel.send({
        content: `Ticket fermé par <@${interaction.user.id}>.`
      });
      await ticketChannel.delete().catch(() => {});
    }

    db.prepare("UPDATE tickets SET status = 'closed' WHERE id = ?").run(userTickets.id);

    return interaction.reply({
      content: "✅ Ticket fermé.",
      ephemeral: false
    });
  }

  return interaction.reply({
    content: "❌ Action inconnue.",
    ephemeral: true
  });
}

const commands = [
  new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Affiche le catalogue du shop")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("buy")
    .setDescription("Passe une commande pour un produit")
    .addStringOption((option) =>
      option
        .setName("product")
        .setDescription("Nom exact du produit")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("quantity")
        .setDescription("Quantité à acheter")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(99)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("paid")
    .setDescription("Admin: marque une commande comme payée après vérification")
    .addStringOption((option) =>
      option
        .setName("order_id")
        .setDescription("ID de la commande")
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("deliver")
    .setDescription("Admin: marque une commande comme livrée")
    .addStringOption((option) =>
      option
        .setName("order_id")
        .setDescription("ID de la commande")
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("additem")
    .setDescription("Admin: ajoute un produit au catalogue")
    .addStringOption((option) =>
      option.setName("name").setDescription("Nom du produit").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("description").setDescription("Description").setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("price").setDescription("Prix en euros").setRequired(true).setMinValue(1)
    )
    .addIntegerOption((option) =>
      option.setName("stock").setDescription("Stock").setRequired(true).setMinValue(0)
    )
    .addStringOption((option) =>
      option
        .setName("category")
        .setDescription("Catégorie du produit")
        .setRequired(true)
        .addChoices(
          { name: "Discord", value: "Discord" },
          { name: "Nitro", value: "Nitro" },
          { name: "Roblox", value: "Roblox" },
          { name: "Autres", value: "Autres" }
        )
    )
    .addStringOption((option) =>
      option.setName("image").setDescription("URL d'image du produit").setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("removeitem")
    .setDescription("Admin: désactive un produit du catalogue")
    .addStringOption((option) =>
      option.setName("name").setDescription("Nom du produit").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("setprice")
    .setDescription("Admin: change le prix d'un produit")
    .addStringOption((option) =>
      option.setName("name").setDescription("Nom du produit").setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("price").setDescription("Nouveau prix").setRequired(true).setMinValue(1)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("stock")
    .setDescription("Admin: ajuste le stock d'un produit")
    .addStringOption((option) =>
      option.setName("name").setDescription("Nom du produit").setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("quantity").setDescription("Nouveau stock").setRequired(true).setMinValue(0)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Ouvre ou ferme un ticket de support")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Créer ou fermer un ticket")
        .setRequired(true)
        .addChoices(
          { name: "Ouvrir", value: "open" },
          { name: "Fermer", value: "close" }
        )
    )
    .toJSON()
];

async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;
  const guildId = process.env.GUILD_ID;

  if (!token || !clientId || !guildId) {
    console.log("⚠️ Variables manquantes. Vérifie DISCORD_TOKEN, CLIENT_ID et GUILD_ID.");
    return;
  }

  const rest = new REST({ version: "10" }).setToken(token);

  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands
    });
    console.log("✅ Commandes slash enregistrées.");
  } catch (error) {
    console.error("Erreur lors de l'enregistrement des commandes :", error);
  }
}

client.on("ready", async () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
  await registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) {
    if (interaction.isStringSelectMenu() && interaction.customId === "shop_category") {
      await showProductsForCategory(interaction, interaction.values[0]);
      return;
    }
    return;
  }

  const { commandName } = interaction;

  try {
    if (commandName === "shop") {
      await sendShopEmbed(interaction);
      return;
    }

    if (commandName === "buy") {
      await handleBuy(interaction);
      return;
    }

    if (commandName === "paid") {
      await handlePaid(interaction);
      return;
    }

    if (commandName === "deliver") {
      await handleDeliver(interaction);
      return;
    }

    if (commandName === "additem") {
      await handleAddItem(interaction);
      return;
    }

    if (commandName === "removeitem") {
      await handleRemoveItem(interaction);
      return;
    }

    if (commandName === "setprice") {
      await handleSetPrice(interaction);
      return;
    }

    if (commandName === "stock") {
      await handleStock(interaction);
      return;
    }

    if (commandName === "ticket") {
      await handleTicket(interaction);
      return;
    }

    await interaction.reply({
      content: "Commande inconnue.",
      ephemeral: true
    });
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: "❌ Une erreur est survenue pendant l'exécution de la commande.",
      ephemeral: true
    });
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const customId = interaction.customId;
  if (!customId.startsWith("buy_")) return;

  const productId = customId.replace("buy_", "");
  const product = db.prepare("SELECT * FROM items WHERE item_id = ? AND enabled = 1").get(productId);

  if (!product) {
    return interaction.reply({
      content: "❌ Ce produit n'est plus disponible.",
      ephemeral: true
    });
  }

  const quantity = 1;
  try {
    await ensureInStockAndNotDuplicate(interaction.user.id, product);

    if (product.stock < quantity) {
      return interaction.reply({
        content: `❌ Stock insuffisant pour "${product.name}".`,
        ephemeral: true
      });
    }

    const orderId = createOrderId();
    const total = product.price * quantity;

    db.prepare(`
      INSERT INTO orders (id, user_id, product_id, product_name, quantity, total, status, created_at, payment_link)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      orderId,
      interaction.user.id,
      product.item_id,
      product.name,
      quantity,
      total,
      new Date().toISOString(),
      getPaypalLink()
    );

    const embed = new EmbedBuilder()
      .setTitle("✅ Commande créée")
      .setDescription(
        `Produit: **${product.name}**\n` +
        `Quantité: **${quantity}**\n` +
        `Total: **${formatMoney(total)}**\n` +
        `ID: \`${orderId}\`\n\n` +
        `Paiement: ${getPaypalLink()}`
      )
      .setColor(0x2ecc71)
      .setThumbnail(product.image || null);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(getPaypalLink())
        .setLabel("Payer")
    );

    await interaction.reply({
      embeds: [embed],
      components: [row]
    });
  } catch (error) {
    await interaction.reply({
      content: `❌ ${error.message}`,
      ephemeral: true
    });
  }
});

initDb();
ensureDefaultProducts();

client.login(process.env.DISCORD_TOKEN);
