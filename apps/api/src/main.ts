import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter';

// Prisma BigInt alanları JSON'a string olarak gider (precision kaybı olmasın).
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? `http://localhost:${process.env.WEB_PORT ?? 3100}`, credentials: true });
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('Protarget pDOOH API')
    .setDescription('Admin, agency/advertiser portal and player delivery API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  const port = Number(process.env.API_PORT ?? 4100);
  await app.listen(port);
  console.log(JSON.stringify({ level: 'info', msg: 'api listening', port }));
}

void bootstrap();
