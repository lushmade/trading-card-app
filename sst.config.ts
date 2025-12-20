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
    const adminPassword = new sst.Secret("AdminPassword");
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
          // Expire cropped images after 14 days - these are derived from originalKey + crop
          // and are no longer used (cropKey is deprecated)
          id: "expire-crop-uploads",
          status: "Enabled",
          filter: {
            prefix: "uploads/crop/",
          },
          expiration: {
            days: 14,
          },
        },
        {
          // Keep original photos for 2 years to support admin re-rendering
          // Originals are canonical data needed to regenerate renders
          id: "expire-original-uploads",
          status: "Enabled",
          filter: {
            prefix: "uploads/original/",
          },
          expiration: {
            days: 730,
          },
        },
        {
          // Renders are derived and can be regenerated, expire after 1 year
          id: "expire-renders",
          status: "Enabled",
          filter: {
            prefix: "renders/",
          },
          expiration: {
            days: 365,
          },
        },
      ],
    });

    const cardsTable = new sst.aws.Dynamo("Cards", {
      fields: {
        id: "string",
        tournamentId: "string",
        status: "string",
        createdAt: "string",
        statusCreatedAt: "string",
      },
      primaryIndex: { hashKey: "id" },
      globalIndexes: {
        byStatus: { hashKey: "status", rangeKey: "createdAt" },
        byTournamentStatus: { hashKey: "tournamentId", rangeKey: "statusCreatedAt" },
      },
    });

    const api = new sst.aws.Function("Api", {
      handler: "server/src/lambda.handler",
      runtime: "nodejs20.x",
      url: {
        cors: {
          allowOrigins: ["*"],
          allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
          allowHeaders: ["Content-Type", "Authorization", "X-Edit-Token"],
        },
      },
      link: [mediaBucket, cardsTable, adminPassword],
    });

    router.route("/api", api.url, {
      rewrite: { regex: "^/api/(.*)$", to: "/$1" },
    });
    router.routeBucket("/r", mediaBucket, {
      rewrite: { regex: "^/r/(.*)$", to: "/renders/$1" },
    });
    router.routeBucket("/c", mediaBucket, {
      rewrite: { regex: "^/c/(.*)$", to: "/config/$1" },
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
