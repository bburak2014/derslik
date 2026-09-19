import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
const db=new DatabaseSync(workerData.path);db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
parentPort.postMessage("ready");Atomics.wait(new Int32Array(workerData.barrier),0,0);
try{db.exec("BEGIN IMMEDIATE");for(const s of workerData.plan)db.prepare(s.sql).run(...s.params);db.exec("COMMIT");parentPort.postMessage({ok:true});}
catch(e){if(db.isTransaction)db.exec("ROLLBACK");parentPort.postMessage({ok:false,error:String(e)});}
finally{db.close();}
