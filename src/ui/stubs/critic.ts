/**
 * 旧スタブの入口。実物（src/critic）と接続テスト（src/ui/lesson/connectionTest.ts）を
 * 同じ名前で再エクスポートする。Settings が import 先を変えたら、このファイルは消してよい。
 */
export * from '@/critic';
export { testConnection, type ConnectionTestResult } from '../lesson/connectionTest';

/** 本物の critic が入っているので true */
export const criticAvailable = true;
