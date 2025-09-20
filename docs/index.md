DBConnectorToolkit
==================

[![Documentation Status](https://app.readthedocs.org/projects/dbconnectortoolkit/badge/?version=latest)](https://dbconnectortoolkit.readthedocs.io/en/latest/)


This library provides an integrated tool to access data, in order to minimize code change when moving from single database to database clusters with read replica, caching layer and centralized database write handling.

We have created a demo project ([DBConnectorSampleWeb](https://github.com/zx2486/DBConnectorSampleWeb)) and a demo site ([dbconnectorapi.authpaper.com](https://dbconnectorapi.authpaper.com)) to illustrate how this library works.

Motivations
-----------

When we learn programming and read / write data to SQL database, we use libraries like node-postgres and interacts with master database directly.
It is normal for most cases. However, the loading on database will be huge when there are multiple instances / pods and a lot of concurrent connections.

To cater the issue of overloading, read replica and caching are introduced on the read side. 
On the write side, strategies like database sharding / write-through cache / message queue / rate limiting are used.
But they involve complicated setup and change in application coding.

This module intends to minimize the changes required on the coding side when different cache / scaling methods are used.
Ideally, the developer will write queries like interacting with a database directly, no matter it is a single db, db with read replica, with cache layer, etc.
All caching logic is handled inside this module.
On the write side, it will return the actual result if master database is present. It will send write queries via message queue and return an UUID if there is a message queue present.

It is different from existing libraries like sequelize-redis-cache as this involves different caching logics and also the write part.

Versioning
----------

When a feature is built and merged into development, the version will be updated by prerelease snapshot.
When a release is going to happen, things will be merged into main. 
The version will be set mannually and a new tag will be created and package will be published.
