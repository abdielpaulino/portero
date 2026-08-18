import "dotenv/config";
import cors from "cors";
import express from "express";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const port = process.env.PORT ?? 3001;

app.listen(port, () => {
  console.log(`api listening on port ${port}`);
});
