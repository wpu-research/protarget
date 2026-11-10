import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter';
import { RuntimeConfig } from './common/runtime-config';

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

/** Does not listen; usable directly by Supertest. Environment is supplied by the launcher. */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  try {
    const config = app.get(RuntimeConfig).values;
    app.getHttpAdapter().getInstance().disable('x-powered-by');
    // Do not trust client-supplied X-Forwarded-For for authentication rate limits.
    app.use((req: Request, res: Response, next: NextFunction) => {
      const requestId = randomUUID();
      (req as Request & { requestId: string }).requestId = requestId;
      res.setHeader('X-Request-Id', requestId);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
      if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      next();
    });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, transform: true,
      validationError: { target: false, value: false },
    }));
    app.useGlobalFilters(new ErrorEnvelopeFilter());
    app.enableCors({ origin: config.webOrigin, credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'] });
    if (config.nodeEnv === 'development') {
      SwaggerModule.setup('api/docs', app, generateSwaggerDocument(app), {
        swaggerOptions: { persistAuthorization: false },
      });
    }
    await app.init();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

/** Export a document without exposing an unguarded Swagger UI in production. */
export function generateSwaggerDocument(app: INestApplication) {
  return SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('Protarget pDOOH API').setVersion('0.1.0')
    .setDescription('Phase 0 identity, administration and read-only organization portal')
    .addCookieAuth('protarget_access', { type: 'apiKey', in: 'cookie' }, 'protarget_access')
    .build());
}

export async function bootstrap(): Promise<void> {
  const app = await createApp();
  app.enableShutdownHooks();
  const port = Number(process.env.API_PORT ?? 4100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    await app.close();
    throw new Error('Invalid API_PORT');
  }
  await app.listen(port, process.env.API_HOST ?? '127.0.0.1');
  console.log(JSON.stringify({ level: 'info', msg: 'api listening', port }));
}

if (require.main === module) {
  void bootstrap().catch(() => {
    console.error(JSON.stringify({ level: 'error', msg: 'API startup failed; verify environment and database' }));
    process.exitCode = 1;
  });
}
