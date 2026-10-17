import { loadPeople } from "../../packages/shared/src/index.ts";
console.log(loadPeople().ben.phone?.endsWith("4648") ? "local people file is used" : "WRONG: example file is used");
