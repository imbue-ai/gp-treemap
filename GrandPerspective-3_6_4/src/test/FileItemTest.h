/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import <Cocoa/Cocoa.h>

@class FileItem;
@protocol FileItemTestVisitor;


typedef NS_ENUM(SInt8, TestResult) {
  TestPassed        = 1,
  TestFailed        = 0,
  TestNotApplicable = -1
};

/* (Abstract) test that can be applied to a FileItem. 
 *
 * Instances should be immutable. Their configuration should remain fixed throughout their lifetime,
 * but furthermore, they should not maintain any state (e.g. for performance optimalisation). The
 * latter is forbidden, as the same test may be used in multiple threads concurrently.
 */
@interface FileItemTest : NSObject {
}

- (instancetype) init NS_DESIGNATED_INITIALIZER;

/* Initialiser when restoring object from preferences. It is meant to be subclassed and should not
 * be invoked directly.
 */
- (instancetype) initWithPropertiesFromDictionary:(NSDictionary *)dict NS_DESIGNATED_INITIALIZER;

+ (FileItemTest *)fileItemTestFromDictionary:(NSDictionary *)dict;

/* Returns a dictionary that represents the test. It can be used for storing object to preferences.
 */
- (NSDictionary *)dictionaryForObject;

@end // @interface FileItemTest


@interface FileItemTest (AbstractMethods)

/* Tests the file item. It returns TestPassed when the item passes the test, TestFailed when the
 * item fails the test, or TestNotApplicable when the test does not apply to the item.
 *
 * A context is passed, which may provide additional information and/or state used by the test. See
 * the ItemPathTest class for an example.
 */
- (TestResult) testFileItem:(FileItem *)item context:(id)context;

/* Returns YES iff the test applies (also) to directories. Returns NO otherwise, i.e. when the test
 * only applies to files and returns TestNotApplicable for directory items.
 */
@property (nonatomic, readonly) BOOL appliesToDirectories;

- (void) acceptFileItemTestVisitor:(NSObject <FileItemTestVisitor> *)visitor;

@end // @interface FileItemTest (AbstractMethods)

@interface FileItemTest (ProtectedMethods)

/* Helper method for storing object to preferences. It is meant overridden by subclasses and should
 * not be called directly.
 */
- (void) addPropertiesToDictionary:(NSMutableDictionary *)dict;

@end // @interface FileItemTest (ProtectedMethods)
