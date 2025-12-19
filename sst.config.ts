/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "trading-card-app",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
    };
  },
  async run() {
    const router = new sst.aws.Router("CardRouter");

    const mediaBucket = new sst.aws.Bucket("Media", {
      access: "cloudfront",
      cors: {
        allowHeaders: ["*"],
        allowMethods: ["GET", "HEAD", "POST", "PUT"],
        allowOrigins: ["http://localhost:5173", "http://localhost:3000"],
      },
    });

    const cardsTable = new sst.aws.Dynamo("Cards", {
      fields: {
        id: "string",
        status: "string",
        createdAt: "string",
      },
      primaryIndex: { hashKey: "id" },
      globalIndexes: {
        byStatus: { hashKey: "status", rangeKey: "createdAt" },
      },
    });

    const api = new sst.aws.Function("Api", {
      handler: "server/src/lambda.handler",
      runtime: "nodejs20.x",
      url: true,
      link: [mediaBucket, cardsTable],
    });

    router.route("/api", api.url, {
      rewrite: { regex: "^/api/(.*)$", to: "/$1" },
    });
    router.routeBucket("/u", mediaBucket, {
      rewrite: { regex: "^/u/(.*)$", to: "/uploads/$1" },
    });
    router.routeBucket("/r", mediaBucket, {
      rewrite: { regex: "^/r/(.*)$", to: "/renders/$1" },
    });

    const web = new sst.aws.StaticSite("Web", {
      path: "client",
      build: {
        command: "pnpm build",
        output: "dist",
      },
      router: { instance: router },
    });

    return {
      web: web.url,
      api: api.url,
      router: router.url,
      media: mediaBucket.name,
      cards: cardsTable.name,
    };
  },
});
