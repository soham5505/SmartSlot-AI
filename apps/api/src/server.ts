import './config/environment';
import app from './app';
import { connectDatabase } from './config/database';

const port = Number(process.env.PORT || 4000);
async function start() {
  try {
    await connectDatabase();
    const server = app.listen(port, '0.0.0.0', () => console.log(`SmartSlot API listening on 0.0.0.0:${port}`));
    const shutdown = () => server.close(() => process.exit(0));
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error: any) {
    console.error(`API startup failed: ${error.message}`);
    process.exit(1);
  }
}
void start();
