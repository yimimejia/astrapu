import { buildApp } from './app.js';
import { migrate } from './db/connection.js';

const port = Number(process.env.PORT || 3000);

await migrate();
const app = buildApp();
app.listen(port, () => {
  console.log(`Astrapu API escuchando en :${port}`);
});
