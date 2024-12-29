import { defineAction } from '../../src/common';

interface TestRequest {
  foo: string;
}

interface TestResponse {
  bar: string;
}

export const testEndpoint = defineAction<TestRequest, TestResponse>()('test');

