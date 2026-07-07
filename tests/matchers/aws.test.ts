import { describe, it, expect } from "vitest";
import { matchAws } from "../../src/matchers/aws.js";

describe("matchAws — logs (allow read-only)", () => {
  it("describe-log-groups with query/output flags", () => {
    expect(
      matchAws(
        `aws logs describe-log-groups --profile drashta-alpha --region eu-central-1 --query "logGroups[?contains(logGroupName, 'RunFile')].logGroupName" --output text`,
      ),
    ).toBe(true);
  });

  it("filter-log-events", () => {
    expect(
      matchAws(
        `aws logs filter-log-events --log-group-name "/aws/lambda/dev-adityatx-Drashta-QueryRunnerRunFileHandler" --profile drashta-alpha --region eu-central-1`,
      ),
    ).toBe(true);
  });

  it("get-log-events", () => {
    expect(matchAws("aws logs get-log-events --log-group-name x --log-stream-name y")).toBe(true);
  });
});

describe("matchAws — stepfunctions (allow read-only)", () => {
  it("describe-execution", () => {
    expect(matchAws('aws stepfunctions describe-execution --execution-arn "arn:aws:states:eu-central-1:1:execution:x:y"')).toBe(true);
  });
  it("list-executions", () => {
    expect(matchAws('aws stepfunctions list-executions --state-machine-arn "arn:aws:states:eu-central-1:1:stateMachine:x"')).toBe(true);
  });
  it("list-map-runs", () => {
    expect(matchAws('aws stepfunctions list-map-runs --execution-arn "arn:aws:states:eu-central-1:1:execution:x:y"')).toBe(true);
  });
  it("describe-map-run", () => {
    expect(matchAws('aws stepfunctions describe-map-run --map-run-arn "arn:aws:states:x"')).toBe(true);
  });
});

describe("matchAws — compound shapes", () => {
  it("cd <dir> && aws logs ...", () => {
    expect(matchAws("cd /tmp && aws logs describe-log-groups --region eu-central-1")).toBe(true);
  });
  it("aws ... | grep", () => {
    expect(matchAws("aws stepfunctions list-executions --state-machine-arn arn:x | grep RUNNING")).toBe(true);
  });
  it("aws ... | jq", () => {
    expect(matchAws("aws logs filter-log-events --log-group-name x | jq '.events'")).toBe(true);
  });
  it("safe stream redirect 2>/dev/null", () => {
    expect(matchAws("aws logs describe-log-groups 2>/dev/null")).toBe(true);
  });
});

describe("matchAws — block writes / mutations", () => {
  it("stepfunctions start-execution", () => {
    expect(matchAws('aws stepfunctions start-execution --state-machine-arn arn:x')).toBe(false);
  });
  it("stepfunctions stop-execution", () => {
    expect(matchAws('aws stepfunctions stop-execution --execution-arn arn:x')).toBe(false);
  });
  it("stepfunctions delete-state-machine", () => {
    expect(matchAws('aws stepfunctions delete-state-machine --state-machine-arn arn:x')).toBe(false);
  });
  it("logs delete-log-group", () => {
    expect(matchAws('aws logs delete-log-group --log-group-name x')).toBe(false);
  });
  it("logs put-log-events", () => {
    expect(matchAws('aws logs put-log-events --log-group-name x --log-stream-name y')).toBe(false);
  });
  it("logs create-log-group", () => {
    expect(matchAws('aws logs create-log-group --log-group-name x')).toBe(false);
  });
});

describe("matchAws — block out-of-scope services", () => {
  it("s3 (not yet supported) is rejected even for read verbs", () => {
    expect(matchAws("aws s3 ls")).toBe(false);
  });
  it("dynamodb get-item is rejected (service not allowlisted)", () => {
    expect(matchAws("aws dynamodb get-item --table-name x")).toBe(false);
  });
  it("iam list-users is rejected (service not allowlisted)", () => {
    expect(matchAws("aws iam list-users")).toBe(false);
  });
});

describe("matchAws — block dangerous shapes", () => {
  it("aws with no subcommand", () => {
    expect(matchAws("aws logs")).toBe(false);
  });
  it("bare aws", () => {
    expect(matchAws("aws")).toBe(false);
  });
  it("file redirection", () => {
    expect(matchAws("aws logs describe-log-groups > /tmp/out.json")).toBe(false);
  });
  it("; chained mutation", () => {
    expect(matchAws("aws logs describe-log-groups; aws logs delete-log-group --log-group-name x")).toBe(false);
  });
  it("&& chained non-cd command", () => {
    expect(matchAws("aws logs describe-log-groups && rm -rf /")).toBe(false);
  });
  it("|| operator", () => {
    expect(matchAws("aws logs describe-log-groups || echo fail")).toBe(false);
  });
  it("pipe to a non-safe target", () => {
    expect(matchAws("aws logs describe-log-groups | sh")).toBe(false);
  });
  it("command substitution", () => {
    expect(matchAws("aws logs describe-log-groups --region $(cat /etc/x)")).toBe(false);
  });
  it("not aws", () => {
    expect(matchAws("kubectl get pods")).toBe(false);
  });
  it("empty", () => {
    expect(matchAws("")).toBe(false);
  });
});
