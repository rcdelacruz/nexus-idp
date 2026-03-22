# Backstage Agent - Quick Start Guide

Get up and running with the Backstage Agent in 5 minutes.

## Prerequisites

Before you begin, ensure you have:

- [x] **Docker Desktop** installed and running
  - Download: https://www.docker.com/products/docker-desktop
  - Verify: `docker ps` (should not error)

- [x] **Node.js 18+** installed
  - Download: https://nodejs.org/
  - Verify: `node --version`

- [x] **Backstage instance** running
  - Local: `http://localhost:7007`
  - Production: Your Backstage URL

- [x] **Google account** with @stratpoint.com email
  - Required for authentication

## Step 1: Build the Agent

```bash
# Navigate to agent directory
cd packages/backstage-agent

# Install dependencies
yarn install

# Build TypeScript
yarn build
```

## Step 2: Link CLI Globally (Optional)

For easier access, link the CLI globally:

```bash
npm link
```

Now you can run `backstage-agent` from anywhere.

## Step 3: Login

Authenticate with your Backstage instance:

```bash
backstage-agent login --url http://localhost:7007
```

**What happens:**
1. Browser opens for Google sign-in
2. Sign in with your @stratpoint.com account
3. Tokens saved to `~/.backstage-agent/config.json`
4. Agent registered with Backstage

**Expected output:**

```
2024-12-26 10:00:00 - info: Starting authentication flow...
2024-12-26 10:00:00 - info: Backstage URL: http://localhost:7007
2024-12-26 10:00:01 - info: Opening browser for Google OAuth...
...
=================================================
  Authentication successful!
=================================================
Agent ID: abc-123-xyz
Token expires: 12/27/2024, 10:00:00 AM

Next steps:
  1. Run "backstage-agent start" to start the agent
  2. Create provisioning tasks from Backstage UI
```

## Step 4: Start the Agent

Start listening for provisioning tasks:

```bash
backstage-agent start
```

**Expected output:**

```
2024-12-26 10:05:00 - info: Loading agent configuration...
2024-12-26 10:05:00 - info: Configuration loaded successfully
2024-12-26 10:05:00 - info: Agent ID: abc-123-xyz
2024-12-26 10:05:00 - info: Backstage URL: http://localhost:7007
2024-12-26 10:05:00 - info: Starting Backstage Agent abc-123-xyz
2024-12-26 10:05:02 - info: SSE connection established
2024-12-26 10:05:02 - info: Agent started successfully. Waiting for tasks...
```

**Leave this running in your terminal.**

## Step 5: Create a Task (from Backstage UI)

1. Open Backstage UI: http://localhost:3000
2. Navigate to **Local Provisioner** page
3. Click **"Create Task"** (or similar button)
4. Fill in task details:
   - **Resource Type**: Kafka
   - **Resource Name**: `my-kafka`
   - **Kafka Version**: `7.5.0`
   - **Port**: `9092`
5. Click **Submit**

## Step 6: Watch the Magic Happen

In your agent terminal, you'll see:

```
2024-12-26 10:06:00 - info: Received task: task-123 (provision-kafka)
2024-12-26 10:06:00 - info: Processing task task-123
2024-12-26 10:06:01 - info: Executing task task-123 for resource: my-kafka
2024-12-26 10:06:01 - info: Docker Compose file written to: /Users/you/.backstage-agent/tasks/task-123/docker-compose.yml
2024-12-26 10:06:02 - info: Starting Docker Compose for resource: my-kafka
2024-12-26 10:06:10 - info: All 2 containers are running
2024-12-26 10:06:11 - info: Task task-123 completed successfully
```

## Step 7: Verify Kafka is Running

Check Docker containers:

```bash
docker ps | grep my-kafka
```

**Expected output:**

```
abc123def456   confluentinc/cp-kafka:7.5.0         ...   my-kafka-kafka
789ghi012jkl   confluentinc/cp-zookeeper:7.5.0     ...   my-kafka-zookeeper
```

Test Kafka connection:

```bash
# List topics (should be empty initially)
docker exec my-kafka-kafka kafka-topics --list --bootstrap-server localhost:9092
```

## Step 8: Use Your Kafka Instance

Connect from your application:

```bash
# Kafka broker
localhost:9092

# Zookeeper
localhost:2181
```

**Example Python code:**

```python
from kafka import KafkaProducer

producer = KafkaProducer(bootstrap_servers=['localhost:9092'])
producer.send('test-topic', b'Hello from Backstage Agent!')
producer.flush()
```

## Stopping the Agent

Press `Ctrl+C` in the agent terminal:

```
^C
2024-12-26 10:10:00 - info: Received SIGINT signal. Shutting down gracefully...
2024-12-26 10:10:01 - info: Agent stopped
```

## Cleaning Up

Remove provisioned resources:

```bash
# Navigate to task directory
cd ~/.backstage-agent/tasks/task-123

# Stop and remove containers
docker-compose down -v

# Or remove all containers matching pattern
docker rm -f $(docker ps -aq --filter name=my-kafka)
```

## Troubleshooting

### "No configuration found"

**Problem**: You haven't logged in yet.

**Solution**: Run `backstage-agent login --url http://localhost:7007`

---

### "Docker is not available or not running"

**Problem**: Docker Desktop is not running.

**Solution**:
1. Open Docker Desktop
2. Wait for it to start
3. Verify with `docker ps`
4. Try again

---

### "Authentication token has expired"

**Problem**: Your token expired (default: 24 hours).

**Solution**: Run `backstage-agent login --url http://localhost:7007` again

---

### "Port already in use"

**Problem**: Port 9092 (or 2181) is already in use.

**Solution**: Change the port in task configuration or stop the existing service

---

### "SSE connection error"

**Problem**: Can't connect to Backstage backend.

**Solution**:
1. Verify Backstage is running: `curl http://localhost:7007/api/local-provisioner/health`
2. Check authentication: Re-run login
3. Check firewall settings

---

## Next Steps

1. **Explore other resources**: Try PostgreSQL, Redis, MongoDB (coming soon)
2. **Integrate with projects**: Use provisioned resources in your applications
3. **Create custom templates**: Add your own Docker Compose templates
4. **Monitor tasks**: Use Backstage UI to track task status

## Getting Help

- **Documentation**: See `README.md` for full documentation
- **Issues**: File GitHub issue
- **Contact**: Reach out to DevOps team

---

**Happy provisioning! 🚀**
