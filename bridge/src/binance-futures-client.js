const crypto = require("crypto");

class BinanceApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "BinanceApiError";
    this.status = details.status || 500;
    this.code = details.code;
    this.payload = details.payload;
  }
}

class BinanceFuturesClient {
  constructor(config) {
    this.baseUrl = config.binanceBaseUrl.replace(/\/+$/, "");
    this.apiKey = config.binanceApiKey;
    this.apiSecret = config.binanceApiSecret;
    this.recvWindow = config.binanceRecvWindow;
    this.timeOffsetMs = 0;
  }

  async syncTime() {
    const server = await this.publicRequest("GET", "/fapi/v1/time");
    this.timeOffsetMs = Number(server.serverTime || 0) - Date.now();
    return this.timeOffsetMs;
  }

  async publicRequest(method, path, params = {}) {
    return this.request(method, path, params, { signed: false });
  }

  async signedRequest(method, path, params = {}) {
    if (!this.apiKey || !this.apiSecret) {
      throw new BinanceApiError("Binance API key/secret ausentes para modo live.", {
        status: 400
      });
    }

    return this.request(method, path, params, { signed: true });
  }

  async request(method, path, params = {}, options = {}) {
    const isSigned = Boolean(options.signed);
    const query = new URLSearchParams();
    const finalParams = { ...params };

    if (isSigned) {
      finalParams.recvWindow = finalParams.recvWindow || this.recvWindow;
      finalParams.timestamp = Date.now() + this.timeOffsetMs;
    }

    Object.keys(finalParams)
      .sort()
      .forEach((key) => {
        const value = finalParams[key];
        if (value === undefined || value === null || value === "") return;
        query.append(key, String(value));
      });

    if (isSigned) {
      const signature = crypto
        .createHmac("sha256", this.apiSecret)
        .update(query.toString())
        .digest("hex");
      query.append("signature", signature);
    }

    const url = `${this.baseUrl}${path}${query.toString() ? `?${query.toString()}` : ""}`;
    const headers = {};

    if (isSigned) {
      headers["X-MBX-APIKEY"] = this.apiKey;
    }

    const response = await fetch(url, {
      method,
      headers
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new BinanceApiError(
        `Binance request falhou em ${path} com HTTP ${response.status}.`,
        {
          status: response.status,
          code: json.code,
          payload: json
        }
      );
    }

    return json;
  }

  getExchangeInfo(symbol) {
    return this.publicRequest("GET", "/fapi/v1/exchangeInfo", { symbol });
  }

  getBalance() {
    return this.signedRequest("GET", "/fapi/v2/balance");
  }

  getPositionRisk(symbol) {
    return this.signedRequest("GET", "/fapi/v3/positionRisk", { symbol });
  }

  changePositionMode(dualSidePosition) {
    return this.signedRequest("POST", "/fapi/v1/positionSide/dual", {
      dualSidePosition: dualSidePosition ? "true" : "false"
    });
  }

  changeMarginType(symbol, marginType) {
    return this.signedRequest("POST", "/fapi/v1/marginType", {
      symbol,
      marginType
    });
  }

  changeLeverage(symbol, leverage) {
    return this.signedRequest("POST", "/fapi/v1/leverage", {
      symbol,
      leverage
    });
  }

  placeOrder(params) {
    return this.signedRequest("POST", "/fapi/v1/order", params);
  }

  getUserTrades(symbol, orderId) {
    return this.signedRequest("GET", "/fapi/v1/userTrades", {
      symbol,
      orderId
    });
  }
}

module.exports = {
  BinanceApiError,
  BinanceFuturesClient
};
