import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import Joi from "joi";
import { stripHtml } from "string-strip-html";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const mongoClient = new MongoClient(process.env.DATABASE_URL);

try {
    await mongoClient.connect();
    console.log("O MongoDB foi conectado com sucesso!");
} catch (error) {
    console.log(error.message);
}

const db = mongoClient.db();

dayjs.extend(utc);
dayjs.extend(timezone);

app.post("/participants", async (req, res) => {

    const schema = Joi.object({ name: Joi.string().trim().min(1).required() });
    const validation = schema.validate(req.body, { abortEarly: false });

    if (validation.error) {
        const errors = validation.error.details.map((detail) => detail.message);
        return res.status(422).send(errors);
    }

    try {

        const participant = {
            name: req.body.name.trim(),
            lastStatus: Date.now()
        }

        const sameName = await db.collection("participants").findOne({ name: participant.name });
        if (sameName) return res.sendStatus(409);

        await db.collection("participants").insertOne(participant);

        const message = {
            from: stripHtml(participant.name).trim(),
            to: "Todos",
            text: "entra na sala...",
            type: "status",
            time: dayjs().tz("America/Sao_Paulo").format("HH:mm:ss")
        };

        await db.collection("messages").insertOne(message);

        res.sendStatus(201);

    } catch (err) {
        res.status(422).send({ message: err.message });
    };
});

app.get("/participants", async (req, res) => {
    const participants = await db.collection("participants").find().toArray();
    res.send(participants);
});

app.post("/messages", async (req, res) => {
    const { to, text, type } = req.body;
    const from = req.headers.user;

    const schema = Joi.object({
        to: Joi.string().trim().min(1).required(),
        text: Joi.string().trim().min(1).required(),
        type: Joi.string().valid("message", "private_message").required(),
    });

    const validation = schema.validate(req.body, { abortEarly: false });

    if (validation.error) {
        const errors = validation.error.details.map((detail) => detail.message);
        return res.status(422).send(errors);
    };

    const fromValidation = await db.collection("participants").findOne({ name: from });

    if (!fromValidation) return res.sendStatus(422);

    try {
        const message = {
            from: stripHtml(from).trim(),
            to: stripHtml(to).trim(),
            text: stripHtml(text).trim(),
            type: stripHtml(type).trim(),
            time: stripHtml(dayjs().tz("America/Sao_Paulo").format("HH:mm:ss")).trim()
        };
        await db.collection("messages").insertOne(message);
        res.sendStatus(201);

    } catch (err) {
        res.status(422).send({ message: err.message });
    }
});

app.get("/messages", async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : Infinity;
    console.log(limit);

    if (limit < 1 || isNaN(limit)) {
        return res.status(422).send({ message: "Invalid limit value!" });
    }

    try {
        const messages = await db.collection("messages").find({
            $or: [
                { to: "Todos" },
                { to: req.headers.user },
                { from: req.headers.user },
                { type: "public" }
            ]
        }).sort({ $natural: -1 }).limit(limit).toArray();

        res.status(200).send(messages);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post("/status", async (req, res) => {
    const name = req.headers.user;
    if (!name) {
        res.sendStatus(404);
    }

    const onlineParticipant = await db.collection("participants").findOne({ name });
    if (!onlineParticipant) {
        res.sendStatus(404);
    }

    await db.collection("participants").updateOne({ name }, { $set: { lastStatus: Date.now() } });
    res.sendStatus(200);
});

setInterval(async () => {
    try {
        const limit = dayjs().subtract(10, "seconds").valueOf();
        const deleted = await db.collection("participants").findOneAndDelete({ lastStatus: { $lt: limit } });

        if (deleted.value) {
            const message = {
                from: deleted.value.name,
                to: "Todos",
                text: "sai da sala...",
                type: "status",
                time: dayjs().tz("America/Sao_Paulo").format("HH:mm:ss"),
            };

            await db.collection("participants").updateOne(
                { name: deleted.value.name },
                { $set: { lastStatus: Date.now() } }
            );

            await db.collection("messages").insertOne(message);
        }
    } catch (err) {
        console.log(err.message)
    }
}, 15000);

const PORT = 5000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));