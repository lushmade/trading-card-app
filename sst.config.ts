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
        // Allow all origins for presigned uploads - bucket is private, URLs are short-lived
        allowOrigins: ["*"],
      },
    });

    new aws.s3.BucketLifecycleConfigurationV2("MediaUploadsLifecycle", {
      bucket: mediaBucket.name,
      rules: [
        {
          id: "expire-uploads",
          status: "Enabled",
          filter: {
            prefix: "uploads/",
          },
          expiration: {
            days: 14,
          },
        },
      ],
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
      url: {
        cors: {
          allowOrigins: ["*"],
          allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
          allowHeaders: ["Content-Type", "Authorization"],
        },
      },
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
      environment: {
        VITE_API_URL: api.url,
        VITE_ROUTER_URL: router.url,
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
