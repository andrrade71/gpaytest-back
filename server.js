import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
app.use(cors());
// Explicitly handle OPTIONS requests without using a path pattern
// (some path-to-regexp versions throw on '*' or '/*'). For OPTIONS we
// invoke the cors middleware and immediately end the request with 204.
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    return cors()(req, res, () => res.sendStatus(204));
  }
  next();
});

app.use(bodyParser.json({ limit: "1mb" }));

const MERCHANT_ID = process.env.CIELO_MERCHANT_ID || "<SANDBOX_MERCHANT_ID>";
const MERCHANT_KEY = process.env.CIELO_MERCHANT_KEY || "<SANDBOX_MERCHANT_KEY>";
const BASE_API =
  process.env.BASE_API || "https://apisandbox.cieloecommerce.cielo.com.br/";
const BASE_QUERY =
  process.env.BASE_QUERY ||
  "https://apiquerysandbox.cieloecommerce.cielo.com.br/";

function cielo(baseURL) {
  return axios.create({
    baseURL: baseURL,
    timeout: 30000,
    headers: {
      MerchantId: MERCHANT_ID,
      MerchantKey: MERCHANT_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
}

function unpackToken(raw) {
  try {
    const t = JSON.parse(raw);
    return {
      signedMessage: t.signedMessage || raw,
      signature: t.signature,
      version: t.protocolVersion,
    };
  } catch {
    return { signedMessage: raw };
  }
}

app.post("/gpay/debit", async (req, res) => {
  try {
    const { GooglePayToken, Amount, OrderId, CustomerName, SoftDescriptor } =
      req.body || {};
    if (!GooglePayToken)
      return res.status(400).json({ error: "GooglePayToken required" });
    if (!Amount || Amount <= 0)
      return res.status(400).json({ error: "Amount invalid" });

    const { signedMessage, signature, version } = unpackToken(GooglePayToken);
    const payload = {
      MerchantOrderId:
        OrderId || `GPay-${Math.random().toString(36).slice(2, 10)}`,
      Customer: {
        Name: CustomerName || "Cliente GPay",
        Identity: "02153939020",
        IdentityType: "CPF",
      },
      Payment: {
        Type: "DebitCard",
        Amount: Amount,
        Authenticate: true,
        Capture: true,
        SoftDescriptor,
        Wallet: {
          Type: "AndroidPay",
          WalletKey: signedMessage,
          AdditionalData: {
            ...(signature ? { Signature: signature } : {}),
            ...(version ? { Version: version } : {}),
          },
        },
      },
    };

    const api = cielo(BASE_API);
    const r = await api.post("1/sales/", payload);
    return res.status(r.status).json(r.data);
  } catch (err) {
    if (err.response)
      return res
        .status(err.response.status)
        .json({ error: "Cielo error", data: err.response.data });
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/pix/create", async (req, res) => {
  try {
    const { Amount, OrderId, CustomerName } = req.body || {};
    if (!Amount || Amount <= 0)
      return res.status(400).json({ error: "Amount invalid" });

    const payload = {
      MerchantOrderId:
        OrderId || `PIX-${Math.random().toString(36).slice(2, 10)}`,
      Customer: { Name: CustomerName || "Cliente Pix" },
      Payment: {
        Type: "Pix",
        Amount,
        Provider: "Cielo2",
        Capture: true,
        QrCode: { Expiration: 3600 },
      },
    };

    const api = cielo(BASE_API);
    const r = await api.post("1/sales/", payload);
    return res.status(r.status).json(r.data);
  } catch (err) {
    if (err.response)
      return res
        .status(err.response.status)
        .json({ error: "Cielo error", data: err.response.data });
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/sales/:paymentId", async (req, res) => {
  try {
    const api = cielo(BASE_QUERY);
    const r = await api.get(`1/sales/${req.params.paymentId}`);
    return res.status(r.status).json(r.data);
  } catch (err) {
    if (err.response)
      return res
        .status(err.response.status)
        .json({ error: "Cielo query error", data: err.response.data });
    return res.status(500).json({ error: String(err.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on :${PORT}`));
