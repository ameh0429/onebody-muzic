import { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute, literal } from 'sequelize';
import { AllowNull, BelongsTo, Column, DataType, Default, DefaultScope, ForeignKey, HasMany, Model, PrimaryKey, Table } from 'sequelize-typescript';

export enum Role { ADMIN = 'ADMIN', MEMBER = 'MEMBER' }
export enum UserStatus { PENDING = 'PENDING', ACTIVE = 'ACTIVE', SUSPENDED = 'SUSPENDED' }
export enum PlaylistType { PERSONAL = 'PERSONAL', REHEARSAL = 'REHEARSAL' }

@DefaultScope(() => ({ attributes: { exclude: ['passwordHash'] } }))
@Table({ tableName: 'User', timestamps: true, indexes: [{ name: 'User_email_key', fields: ['email'], unique: true }, { name: 'User_role_status_idx', fields: ['role', 'status'], unique: false }, { name: 'User_status_createdAt_idx', fields: ['status', 'createdAt'], unique: false }] })
export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  @PrimaryKey
  @Default(literal('gen_random_uuid()'))
  @Column(DataType.UUID)
  declare id: CreationOptional<string>;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare name: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare email: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare passwordHash: string;

  @AllowNull(false)
  @Default(Role.MEMBER)
  @Column(DataType.ENUM(...Object.values(Role)))
  declare role: CreationOptional<Role>;

  @AllowNull(false)
  @Default(UserStatus.PENDING)
  @Column(DataType.ENUM(...Object.values(UserStatus)))
  declare status: CreationOptional<UserStatus>;

  @Column(DataType.DATE(3))
  declare createdAt: CreationOptional<Date>;

  @Column(DataType.DATE(3))
  declare updatedAt: CreationOptional<Date>;

  @HasMany(() => Song, 'uploadedById')
  declare uploadedSongs: NonAttribute<Song[]>;

  @HasMany(() => Playlist, 'createdById')
  declare playlists: NonAttribute<Playlist[]>;

  @HasMany(() => Rehearsal, 'createdById')
  declare rehearsals: NonAttribute<Rehearsal[]>;

  // Also redact create/unscoped results when serialized; never expose hashes in JSON.
  override toJSON<T extends object = InferAttributes<User>>(): T {
    const values: Record<string, unknown> = { ...this.get({ plain: true }) };
    delete values.passwordHash;
    return values as T;
  }
}

@Table({ tableName: 'Artist', timestamps: true, indexes: [{ name: 'Artist_name_idx', fields: ['name'], unique: false }] })
export class Artist extends Model<InferAttributes<Artist>, InferCreationAttributes<Artist>> {
  @PrimaryKey
  @Default(literal('gen_random_uuid()'))
  @Column(DataType.UUID)
  declare id: CreationOptional<string>;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare name: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare biography: string | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare imageUrl: string | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare imagePublicId: string | null;

  @Column(DataType.DATE(3))
  declare createdAt: CreationOptional<Date>;

  @Column(DataType.DATE(3))
  declare updatedAt: CreationOptional<Date>;

  @HasMany(() => Album, 'artistId')
  declare albums: NonAttribute<Album[]>;

  @HasMany(() => Song, 'artistId')
  declare songs: NonAttribute<Song[]>;
}

@Table({ tableName: 'Album', timestamps: true, indexes: [{ name: 'Album_artistId_releaseYear_idx', fields: ['artistId', 'releaseYear'], unique: false }, { name: 'Album_title_idx', fields: ['title'], unique: false }] })
export class Album extends Model<InferAttributes<Album>, InferCreationAttributes<Album>> {
  @PrimaryKey
  @Default(literal('gen_random_uuid()'))
  @Column(DataType.UUID)
  declare id: CreationOptional<string>;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare title: string;

  @ForeignKey(() => Artist)
  @AllowNull(false)
  @Column(DataType.UUID)
  declare artistId: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare coverImageUrl: string | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare coverImagePublicId: string | null;

  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare releaseYear: number | null;

  @Column(DataType.DATE(3))
  declare createdAt: CreationOptional<Date>;

  @Column(DataType.DATE(3))
  declare updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Artist, { foreignKey: 'artistId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' })
  declare artist: NonAttribute<Artist>;

  @HasMany(() => Song, 'albumId')
  declare songs: NonAttribute<Song[]>;
}

@Table({ tableName: 'Song', timestamps: true, indexes: [{ name: 'Song_artistId_idx', fields: ['artistId'], unique: false }, { name: 'Song_albumId_idx', fields: ['albumId'], unique: false }, { name: 'Song_uploadedById_idx', fields: ['uploadedById'], unique: false }, { name: 'Song_category_createdAt_idx', fields: ['category', 'createdAt'], unique: false }, { name: 'Song_title_idx', fields: ['title'], unique: false }, { name: 'Song_createdAt_idx', fields: ['createdAt'], unique: false }] })
export class Song extends Model<InferAttributes<Song>, InferCreationAttributes<Song>> {
  @PrimaryKey
  @Default(literal('gen_random_uuid()'))
  @Column(DataType.UUID)
  declare id: CreationOptional<string>;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare title: string;

  @ForeignKey(() => Artist)
  @AllowNull(false)
  @Column(DataType.UUID)
  declare artistId: string;

  @ForeignKey(() => Album)
  @AllowNull(true)
  @Column(DataType.UUID)
  declare albumId: string | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare category: string | null;

  @AllowNull(true)
  @Column(DataType.INTEGER)
  declare durationSeconds: number | null;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare audioPublicId: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare audioResourceType: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare coverImageUrl: string | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare coverImagePublicId: string | null;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column(DataType.UUID)
  declare uploadedById: string;

  @Column(DataType.DATE(3))
  declare createdAt: CreationOptional<Date>;

  @Column(DataType.DATE(3))
  declare updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Artist, { foreignKey: 'artistId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' })
  declare artist: NonAttribute<Artist>;

  @BelongsTo(() => Album, { foreignKey: 'albumId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' })
  declare album: NonAttribute<Album | null>;

  @BelongsTo(() => User, { foreignKey: 'uploadedById', onDelete: 'RESTRICT', onUpdate: 'CASCADE' })
  declare uploadedBy: NonAttribute<User>;

  @HasMany(() => PlaylistSong, 'songId')
  declare playlistSongs: NonAttribute<PlaylistSong[]>;
}

@Table({ tableName: 'Playlist', timestamps: true, indexes: [{ name: 'Playlist_createdById_type_idx', fields: ['createdById', 'type'], unique: false }, { name: 'Playlist_type_createdAt_idx', fields: ['type', 'createdAt'], unique: false }] })
export class Playlist extends Model<InferAttributes<Playlist>, InferCreationAttributes<Playlist>> {
  @PrimaryKey
  @Default(literal('gen_random_uuid()'))
  @Column(DataType.UUID)
  declare id: CreationOptional<string>;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare title: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare description: string | null;

  @AllowNull(false)
  @Default(PlaylistType.PERSONAL)
  @Column(DataType.ENUM(...Object.values(PlaylistType)))
  declare type: CreationOptional<PlaylistType>;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column(DataType.UUID)
  declare createdById: string;

  @Column(DataType.DATE(3))
  declare createdAt: CreationOptional<Date>;

  @Column(DataType.DATE(3))
  declare updatedAt: CreationOptional<Date>;

  @BelongsTo(() => User, { foreignKey: 'createdById', onDelete: 'RESTRICT', onUpdate: 'CASCADE' })
  declare createdBy: NonAttribute<User>;

  @HasMany(() => PlaylistSong, 'playlistId')
  declare songs: NonAttribute<PlaylistSong[]>;

  @HasMany(() => Rehearsal, 'playlistId')
  declare rehearsals: NonAttribute<Rehearsal[]>;
}

@Table({ tableName: 'PlaylistSong', timestamps: true, updatedAt: false, indexes: [{ name: 'PlaylistSong_playlistId_songId_key', fields: ['playlistId', 'songId'], unique: true }, { name: 'PlaylistSong_playlistId_position_key', fields: ['playlistId', 'position'], unique: true }, { name: 'PlaylistSong_songId_idx', fields: ['songId'], unique: false }] })
export class PlaylistSong extends Model<InferAttributes<PlaylistSong>, InferCreationAttributes<PlaylistSong>> {
  @PrimaryKey
  @Default(literal('gen_random_uuid()'))
  @Column(DataType.UUID)
  declare id: CreationOptional<string>;

  @ForeignKey(() => Playlist)
  @AllowNull(false)
  @Column(DataType.UUID)
  declare playlistId: string;

  @ForeignKey(() => Song)
  @AllowNull(false)
  @Column(DataType.UUID)
  declare songId: string;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare position: number;

  @Column(DataType.DATE(3))
  declare createdAt: CreationOptional<Date>;

  @BelongsTo(() => Playlist, { foreignKey: 'playlistId', onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  declare playlist: NonAttribute<Playlist>;

  @BelongsTo(() => Song, { foreignKey: 'songId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' })
  declare song: NonAttribute<Song>;
}

@Table({ tableName: 'Rehearsal', timestamps: true, indexes: [{ name: 'Rehearsal_playlistId_idx', fields: ['playlistId'], unique: false }, { name: 'Rehearsal_createdById_scheduledAt_idx', fields: ['createdById', 'scheduledAt'], unique: false }, { name: 'Rehearsal_scheduledAt_idx', fields: ['scheduledAt'], unique: false }] })
export class Rehearsal extends Model<InferAttributes<Rehearsal>, InferCreationAttributes<Rehearsal>> {
  @PrimaryKey
  @Default(literal('gen_random_uuid()'))
  @Column(DataType.UUID)
  declare id: CreationOptional<string>;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare title: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare description: string | null;

  @AllowNull(false)
  @Column(DataType.DATE(3))
  declare scheduledAt: Date;

  @ForeignKey(() => Playlist)
  @AllowNull(false)
  @Column(DataType.UUID)
  declare playlistId: string;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column(DataType.UUID)
  declare createdById: string;

  @Column(DataType.DATE(3))
  declare createdAt: CreationOptional<Date>;

  @Column(DataType.DATE(3))
  declare updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Playlist, { foreignKey: 'playlistId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' })
  declare playlist: NonAttribute<Playlist>;

  @BelongsTo(() => User, { foreignKey: 'createdById', onDelete: 'RESTRICT', onUpdate: 'CASCADE' })
  declare createdBy: NonAttribute<User>;
}

export const DATABASE_MODELS = [User, Artist, Album, Song, Playlist, PlaylistSong, Rehearsal];
