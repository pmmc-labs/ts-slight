import { main } from '../src/index.ts';

main().catch((e) => {
    console.error(String(e));
    process.exit(1);
});
